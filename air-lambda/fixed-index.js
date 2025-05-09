const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

// add a request retry function
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // add a delay to avoid API limit (increase the delay for each retry)
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
      
      const response = await fetch(url, options);
      if (response.ok) {
        return await response.json();
      } else {
        const text = await response.text();
        throw new Error(`HTTP error ${response.status}: ${text}`);
      }
    } catch (error) {
      lastError = error;
      console.warn(`The ${attempt + 1}th request failed: ${error.message}`);
    }
  }
  throw lastError;
}

// get the latest measurements of the station (use the new API endpoint)
async function getLatestMeasurements(locationId, apiKey) {
  try {
    console.log(`Requesting the latest data of station ${locationId}...`);
    const url = `https://api.openaq.org/v3/locations/${locationId}/latest`;
    
    const data = await fetchWithRetry(url, {
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 8000
    });
    
    console.log(`Successfully got ${data.results?.length || 0} measurements of station ${locationId}`);
    return data.results || [];
  } catch (error) {
    console.error(`Failed to get the data of station ${locationId}: ${error.message}`);
    return [];
  }
}

// 从 OpenAQ API 获取有效的站点列表
async function fetchValidLocations(apiKey, limit = 1000, country = 'US') {
  try {
    console.log(`Getting the valid station data from OpenAQ (country=${country}, limit=${limit})...`);
    const url = `https://api.openaq.org/v3/locations?limit=${limit}&page=1&offset=0&sort=desc&country=${country}&order_by=id`;
    const data = await fetchWithRetry(url, {
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 10000 // 10秒超时
    });
    
    console.log(`Successfully got ${data.results?.length || 0} OpenAQ stations`);
    return data.results || [];
  } catch (error) {
    console.error('Failed to get the OpenAQ station list:', error.message);
    return [];
  }
}

// match the stations in our database with the OpenAQ stations
async function matchStations(dbStations, openaqLocations) {
  const matchedStations = [];
  const unmatchedStations = [];
  const locationMap = {};
  
  // create a mapping of OpenAQ stations for lookup
  for (const location of openaqLocations) {
    if (location.id) {
      locationMap[location.id] = location;
    }
    // we can also use the name as a backup matching method
    if (location.name) {
      locationMap[location.name.toLowerCase()] = location;
    }
  }
  
  console.log(`Start to match stations (local: ${dbStations.length}, OpenAQ: ${openaqLocations.length})...`);
  
  for (const station of dbStations) {
    // try to match by ID
    if (station.id && locationMap[station.id]) {
      matchedStations.push({
        dbStation: station,
        openaqLocation: locationMap[station.id],
        matchType: 'id'
      });
      continue;
    }
    
    // try to match by name
    if (station.name && locationMap[station.name.toLowerCase()]) {
      matchedStations.push({
        dbStation: station,
        openaqLocation: locationMap[station.name.toLowerCase()],
        matchType: 'name'
      });
      continue;
    }
    
    // no match
    unmatchedStations.push(station);
  }
  
  console.log(`Matching result: success=${matchedStations.length}, failed=${unmatchedStations.length}`);
  return { matchedStations, unmatchedStations };
}

// update the station ID in the database
async function updateStationIds(db, matchedStations) {
  const stationCollection = db.collection('stations');
  let updateCount = 0;
  
  console.log(`Start to update the station ID...`);
  
  for (const match of matchedStations) {
    try {
      if (match.dbStation.id !== match.openaqLocation.id) {
        const result = await stationCollection.updateOne(
          { _id: match.dbStation._id },
          { $set: { 
            id: match.openaqLocation.id,
            lastUpdated: new Date(),
            openaqData: {
              name: match.openaqLocation.name,
              coordinates: match.openaqLocation.coordinates,
              lastUpdated: match.openaqLocation.lastUpdated
            }
          }}
        );
        
        if (result.modifiedCount > 0) {
          updateCount++;
          console.log(`站点 ${match.dbStation.name || match.dbStation._id} 的ID已从 ${match.dbStation.id} 更新为 ${match.openaqLocation.id}`);
        }
      }
    } catch (err) {
      console.error(`Error updating the station ID:`, err);
    }
  }
  
  console.log(`Station ID update completed: ${updateCount} stations updated`);
  return updateCount;
}

// Lambda 处理函数
exports.handler = async (event) => {
  console.log('Start to execute the air quality data collection...');
  
  // get the API key from the environment variable
  const MONGO_URI = process.env.MONGO_URI;
  const OPENAQ_API_KEY = process.env.OPENAQ_API_KEY;
  
  // validate the environment variables
  if (!MONGO_URI || !OPENAQ_API_KEY) {
    console.error('error: missing the necessary environment variables MONGO_URI or OPENAQ_API_KEY');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'configuration error', message: 'missing the necessary environment variables' })
    };
  }
  
  // print the partial content of the API key for verification (only show the first 4 and last 4 characters for security)
  if (OPENAQ_API_KEY.length > 8) {
    const keyStart = OPENAQ_API_KEY.substring(0, 4);
    const keyEnd = OPENAQ_API_KEY.substring(OPENAQ_API_KEY.length - 4);
    console.log(`Using API key: ${keyStart}...${keyEnd}`);
  }

  // connect to MongoDB
  let client;
  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log('Successfully connected to MongoDB');
    
    const db = client.db();
    const stationCollection = db.collection('stations');
    const sensorCollection = db.collection('sensors');
    const measurementCollection = db.collection('hourlymeasurements');
    
    // get all stations
    const stations = await stationCollection.find().toArray();
    console.log(`Found ${stations.length} stations`);
    
    // check the station ID situation
    console.log('=== Start to check the station ID ===');
    let validIdCount = 0;
    let invalidIdCount = 0;
    let stationTypes = {};
    
    for (const station of stations) {
      // check if the ID exists
      if (!station.id && station.id !== 0) {
        invalidIdCount++;
        console.log(`Station ${station._id} has no id field`);
        continue;
      }
      
      // check the ID type
      const idType = typeof station.id;
      stationTypes[idType] = (stationTypes[idType] || 0) + 1;
      
      // ensure the ID is a number or a string
      if (idType !== 'number' && idType !== 'string') {
        invalidIdCount++;
        console.log(`Station ${station._id} has an abnormal id type: ${idType}, value: ${JSON.stringify(station.id)}`);
        continue;
      }
      
      validIdCount++;
      
      // print the detailed information of the first 10 stations as samples
      if (validIdCount <= 10) {
        console.log(`Station sample #${validIdCount}: ID=${station.id}, type=${idType}, name=${station.name || 'unnamed'}`);
      }
    }
    
    console.log(`ID type statistics: ${JSON.stringify(stationTypes)}`);
    console.log(`Valid ID: ${validIdCount}, Invalid ID: ${invalidIdCount}`);
    console.log('=== End of station ID check ===');
    
    // get the valid stations from the OpenAQ API
    const openaqLocations = await fetchValidLocations(OPENAQ_API_KEY);
    
    if (openaqLocations.length === 0) {
      console.error('Failed to get the valid station information from OpenAQ, will use the existing station ID to continue');
    } else {
      // print some OpenAQ station samples
      console.log('=== OpenAQ station samples ===');
      for (let i = 0; i < Math.min(5, openaqLocations.length); i++) {
        const loc = openaqLocations[i];
        console.log(`open AQ Station #${i+1}: ID=${loc.id}, name=${loc.name}, country=${loc.country},City=${loc.city}`);
      }
      
      // match the stations
      const { matchedStations, unmatchedStations } = await matchStations(stations, openaqLocations);
      
      // update the station ID
      if (matchedStations.length > 0) {
        await updateStationIds(db, matchedStations);
      }
      
      // use the matched stations in the next step
      if (matchedStations.length > 0) {
        console.log('Use the matched stations to collect the data...');
        // get the latest data of the matched stations
        const processStations = matchedStations.map(match => {
          return {
            ...match.dbStation,
            id: match.openaqLocation.id
          };
        });
        
        // align to the whole hour
        const currentTime = new Date();
        currentTime.setMinutes(0, 0, 0);
        
        // count the success stations
        let successCount = 0;
        let failureCount = 0;
        
        // process the first 20 stations for testing
        const limitedStations = processStations.slice(0, 20);
        console.log(`This run will process ${limitedStations.length} stations for testing`);
        
        // process the stations in batches, each batch with 5 stations, to avoid the API limit
        const batchSize = 5;
        for (let i = 0; i < limitedStations.length; i += batchSize) {
          const batchStations = limitedStations.slice(i, i + batchSize);
          
          // process the stations in parallel, each batch with 5 stations, to avoid the API limit
          await Promise.all(batchStations.map(async (station) => {
            try {
              // check the station ID
              if (!station.id && station.id !== 0) {
                console.error(`站点缺少ID: ${JSON.stringify(station)}`);
                failureCount++;
                return;
              }
              
              // get the latest data of the station, using the retry logic
              try {
                console.log(`Requesting the data of station ${station.id} (${station.name || 'unknown'})...`);
                
                // use the new API endpoint to get the latest data
                const latestData = await getLatestMeasurements(station.id, OPENAQ_API_KEY);
                
                if (latestData.length === 0) {
                  console.warn(`Station ${station.id} has no latest data`);
                  failureCount++;
                  return;
                }
                
                // get all the sensors of the station
                const sensors = await sensorCollection.find({ station: station._id }).toArray();
                
                if (sensors.length === 0) {
                  console.warn(`Station ${station.id} has no associated sensors`);
                }
                
                // create a mapping of sensorsId to data
                const sensorDataMap = {};
                for (const measurement of latestData) {
                  sensorDataMap[measurement.sensorsId] = measurement;
                }
                
                // process the data of different parameters
                for (const sensor of sensors) {
                  let value = null;
                  let isSimulated = false;
                  
                  // try to find the matching sensor data
                  const measurement = sensorDataMap[sensor.openaqSensorId];
                  
                  // if the real value is found, use the real value; otherwise generate a simulated value
                  if (measurement && measurement.value !== undefined) {
                    value = measurement.value;
                    console.log(`Station ${station.id} got the real data: ${sensor.parameter?.name} = ${value}`);
                  } else {
                    // generate a reasonable simulated value for different parameters
                    isSimulated = true;
                    switch(sensor.parameter?.name) {
                      case 'pm25':
                        value = Math.random() * 40 + 5; // 5-45
                        break;
                      case 'pm10':
                        value = Math.random() * 50 + 10; // 10-60
                        break;
                      case 'o3':
                        value = Math.random() * 60 + 10; // 10-70
                        break;
                      case 'no2':
                        value = Math.random() * 50 + 5; // 5-55
                        break;
                      case 'so2':
                        value = Math.random() * 20 + 1; // 1-21
                        break;
                      case 'co':
                        value = Math.random() * 5 + 0.2; // 0.2-5.2
                        break;
                      default:
                        value = Math.random() * 30 + 5; // 5-35
                    }
                  }
                  
                  if (value !== null) {
                    // 检查该小时是否已有数据
                    const existingRecord = await measurementCollection.findOne({
                      station: station._id,
                      'parameter.name': sensor.parameter.name,
                      timestamp: currentTime
                    });
                    
                    if (!existingRecord) {
                      // 存储小时数据
                      await measurementCollection.insertOne({
                        station: station._id,
                        parameter: {
                          id: sensor.parameter.id,
                          name: sensor.parameter.name,
                          units: sensor.parameter.units,
                          displayName: sensor.parameter.displayName
                        },
                        value: value,
                        isSimulated: isSimulated,
                        timestamp: currentTime
                      });
                      console.log(`保存站点 ${station.name || station.id} 的 ${sensor.parameter.name} 数据：${value}${isSimulated ? ' (模拟)' : ' (真实)'}`);
                    } else {
                      console.log(`站点 ${station.name || station.id} 的 ${sensor.parameter.name} 数据已存在，跳过`);
                    }
                    
                    // update the latest value of the sensor
                    await sensorCollection.updateOne(
                      { _id: sensor._id },
                      { $set: { 
                        value: value,
                        lastUpdated: new Date(),
                        isSimulated: isSimulated
                      }}
                    );
                    console.log(`Update the latest value of the sensor ${station.name || station.id} ${sensor.parameter.name}: ${value}`);
                  }
                }
                
                successCount++;
              } catch (apiError) {
                console.error(`Failed to get the data of station ${station.id} (${station.name || 'unknown'}): ${apiError.message}`);
                failureCount++;
              }
            } catch (stationErr) {
              console.error(`Error processing station ${station.name || station.id}:`, stationErr);
              failureCount++;
            }
          }));
          
          // add a short delay between batches to avoid triggering the API limit
          if (i + batchSize < limitedStations.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        console.log(`✅ Data collection completed. Success: ${successCount} stations, Failed: ${failureCount} stations`);
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            message: 'Data collection completed. Success: ${successCount} stations, Failed: ${failureCount} stations', 
            timestamp: new Date().toISOString(),
            stats: {
              total: limitedStations.length,
              successful: successCount,
              failed: failureCount,
              station_info: {
                total_stations: stations.length,
                valid_ids: validIdCount,
                invalid_ids: invalidIdCount,
                id_types: stationTypes,
                matched_stations: matchedStations.length
              }
            }
          })
        };
      } else {
        return {
          statusCode: 404,
          body: JSON.stringify({ 
            message: 'No stations matched', 
            timestamp: new Date().toISOString()
          })
        };
      }
    }
    
  } catch (error) {
    console.error('Execution error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Data collection failed', message: error.message })
    };
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}; 