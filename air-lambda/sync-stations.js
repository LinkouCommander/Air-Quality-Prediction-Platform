const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');
require('dotenv').config();

// Retry function
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retrying the ${attempt + 1}th time...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
      
      const response = await fetch(url, options);
      if (response.ok) {
        return await response.json();
      } else {
        const text = await response.text();
        throw new Error(`HTTP 错误 ${response.status}: ${text}`);
      }
    } catch (error) {
      lastError = error;
      console.warn(`Request failed: ${error.message}`);
    }
  }
  throw lastError;
}

// Get all stations from the OpenAQ API
async function fetchAllLocations(apiKey, country = null, limit = 1000) {
  let allLocations = [];
  let page = 1;
  let hasMore = true;
  
  console.log('Starting to fetch OpenAQ station data...');
  
  while (hasMore) {
    try {
      let url = `https://api.openaq.org/v3/locations?limit=${limit}&page=${page}&offset=0&sort=desc&order_by=id`;
      if (country) {
        url += `&country=${country}`;
      }
      
      console.log(`Fetching the ${page}th page of station data...`);
      const data = await fetchWithRetry(url, {
        headers: {
          'X-API-Key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      
      if (data.results && data.results.length > 0) {
        allLocations = allLocations.concat(data.results);
        console.log(`Fetched ${allLocations.length} stations`);
        page++;
        
        // If the number of results is less than the requested limit, there is no more data
        if (data.results.length < limit) {
          hasMore = false;
        }
        
        // Avoid too many requests, add a delay
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(`Failed to fetch station data: ${error.message}`);
      hasMore = false;
    }
  }
  
  console.log(`Total fetched ${allLocations.length} OpenAQ station data`);
  return allLocations;
} 

// 主函数
async function syncStations() {
  // Get environment variables
  const MONGO_URI = process.env.MONGO_URI;
  const OPENAQ_API_KEY = process.env.OPENAQ_API_KEY;
  
  if (!MONGO_URI || !OPENAQ_API_KEY) {
    console.error('Error: Missing required environment variables MONGO_URI or OPENAQ_API_KEY');
    return;
  }
  
  // MongoDB connection
  let client;
  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const stationCollection = db.collection('stations');
    
    // Get all OpenAQ station data
    const openaqLocations = await fetchAllLocations(OPENAQ_API_KEY);
    
    if (openaqLocations.length === 0) {
      console.error('Failed to fetch OpenAQ station data, sync terminated');
      return;
    }
    
    // Save the mapping of existing stations, for later updates
    const existingStations = await stationCollection.find({}).toArray();
    console.log(`Database has ${existingStations.length} stations`);
    
    // Create a station ID mapping
    const existingStationMap = new Map();
    for (const station of existingStations) {
      existingStationMap.set(station._id.toString(), station);
      // Use name as an alternative key
      if (station.name) {
        existingStationMap.set(station.name.toLowerCase(), station);
      }
    }
    
    // Update existing stations and add new stations
    let updateCount = 0;
    let insertCount = 0;
    const operations = [];
    
    for (const location of openaqLocations) {
      // Check if the station already exists (match by ID or name)
      let existingStation = null;
      
      if (location.id) {
        // Find existing station by ID
        const matchingStations = existingStations.filter(s => 
          s.id === location.id || 
          (s.openaqId && s.openaqId === location.id)
        );
        
        if (matchingStations.length > 0) {
          existingStation = matchingStations[0];
        }
      } 
      
      // If no station is found by ID, try to match by name
      if (!existingStation && location.name) {
        const matchingStations = existingStations.filter(s =>
          s.name && s.name.toLowerCase() === location.name.toLowerCase()
        );
        
        if (matchingStations.length > 0) {
          existingStation = matchingStations[0];
        }
      }
      
      // Update existing stations or add new stations
      if (existingStation) {
        // Update existing station
        operations.push({
          updateOne: {
            filter: { _id: existingStation._id },
            update: {
              $set: {
                id: location.id,
                openaqId: location.id, // Save an extra redundant field
                name: location.name,
                city: location.city,
                country: location.country,
                coordinates: location.coordinates,
                lastUpdated: new Date(),
                openaqData: {
                  name: location.name,
                  coordinates: location.coordinates,
                  lastUpdated: location.lastUpdated,
                  parameters: location.parameters,
                  providers: location.providers,
                  isMobile: location.isMobile,
                  isAnalysis: location.isAnalysis
                }
              }
            }
          }
        });
        updateCount++;
      } else {
        // Add new station
        operations.push({
          insertOne: {
            document: {
              id: location.id,
              openaqId: location.id,
              name: location.name,
              city: location.city,
              country: location.country,
              coordinates: location.coordinates,
              createdAt: new Date(),
              lastUpdated: new Date(),
              openaqData: {
                name: location.name,
                coordinates: location.coordinates,
                lastUpdated: location.lastUpdated,
                parameters: location.parameters,
                providers: location.providers,
                isMobile: location.isMobile,
                isAnalysis: location.isAnalysis
              }
            }
          }
        });
        insertCount++;
      }
      
      // Batch execute database operations, avoid too many operations at once
      if (operations.length >= 500) {
        console.log(`Executing bulk operations: ${operations.length} operations`);
        await stationCollection.bulkWrite(operations);
        operations.length = 0; // Clear the array
      }
    }
    
    // Execute the remaining operations
    if (operations.length > 0) {
      console.log(`Executing the remaining bulk operations: ${operations.length} operations`);
      await stationCollection.bulkWrite(operations);
    }
    
    console.log(`Sync completed! Updated ${updateCount} stations, added ${insertCount} new stations`);
    
  } catch (error) {
    console.error('Execution error:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// execute the main function
syncStations().catch(console.error); 