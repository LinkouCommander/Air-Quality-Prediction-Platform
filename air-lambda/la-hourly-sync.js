const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

//  Lambda  version 
const LAMBDA_VERSION = '1.0.0';

  // Los Angeles Bounds
const LA_BOUNDS = {
  minLat: 33.6, // South boundary
  maxLat: 34.8, // North boundary
  minLng: -118.9, // West boundary
  maxLng: -117.5 // East boundary
};

// add request retry function
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // add delay to avoid API limit (use exponential backoff to increase delay each retry)
      if (attempt > 0) {
        const delayMs = 2000 * Math.pow(2, attempt); // 2 seconds, 4 seconds, 8 seconds...
        console.log(`Waiting ${delayMs/1000} seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
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
      timeout: 10000 // 增加超时时间到10秒
    });
    
    console.log(`Got ${data.results?.length || 0} measurements of station ${locationId}`);
    return data.results || [];
  } catch (error) {
    console.error(`Failed to get data of station ${locationId}: ${error.message}`);
    return [];
  }
}

// check if the station is in Los Angeles
function isInLosAngeles(station) {
  if (!station.coordinates || 
      station.coordinates.latitude === undefined || 
      station.coordinates.longitude === undefined) {
    return false;
  }
  
  const lat = station.coordinates.latitude;
  const lng = station.coordinates.longitude;
  
  return (
    lat >= LA_BOUNDS.minLat && 
    lat <= LA_BOUNDS.maxLat && 
    lng >= LA_BOUNDS.minLng && 
    lng <= LA_BOUNDS.maxLng
  );
}

// generate simulated data based on the parameter name
function generateSimulatedValue(paramName) {
  // generate a reasonable random value based on the parameter type
  switch(paramName) {
    case 'pm25':
      return Math.random() * 40 + 5; // 5-45
    case 'pm10':
      return Math.random() * 50 + 10; // 10-60
    case 'o3':
      return Math.random() * 60 + 10; // 10-70
    case 'no2':
      return Math.random() * 50 + 5; // 5-55
    case 'so2':
      return Math.random() * 20 + 1; // 1-21
    case 'co':
      return Math.random() * 5 + 0.2; // 0.2-5.2
    default:
      return Math.random() * 30 + 5; // 5-35
  }
}

// process the data of a single station
async function processStation(station, openaqApiKey, collections, currentTime) {
  try {
    // validate the station ID
    if (!station.id && station.id !== 0) {
      console.error(`Station missing ID: ${JSON.stringify(station._id)}`);
      return { success: false, reason: 'missing_id' };
    }
    
    // get the latest data of the station
    const latestData = await getLatestMeasurements(station.id, openaqApiKey);
    
    if (latestData.length === 0) {
      console.warn(`Station ${station.id} (${station.name || 'unknown'}) has no latest data`);
      return { success: false, reason: 'no_data' };
    }
    
    // get all sensors of the station
    const sensors = await collections.sensorCollection.find({ station: station._id }).toArray();
    
    if (sensors.length === 0) {
      console.warn(`Station ${station.id} (${station.name || 'unknown'}) has no associated sensors`);
      return { success: false, reason: 'no_sensors' };
    }
    
    // create a map of sensorsId to data
    const sensorDataMap = {};
    for (const measurement of latestData) {
      sensorDataMap[measurement.sensorsId] = measurement;
    }
    
    let stationDataUpdated = false;
    let sensorsProcessed = 0;
    let recordsCreated = 0;
    
    // process the data of different parameters
    for (const sensor of sensors) {
      let value = null;
      let isSimulated = false;
      
      // try to find the matching sensor data
      // if the sensor has the openaqSensorId field, use it preferentially
      const sensorId = sensor.openaqSensorId || sensor.id;
      const measurement = sensorDataMap[sensorId];
      
      // if the real value is found, use it; otherwise generate a simulated value
      if (measurement && measurement.value !== undefined) {
        value = measurement.value;
        console.log(`Station ${station.id} (${station.name || 'unknown'}) got real data: ${sensor.parameter?.name} = ${value}`);
      } else {
        // generate a reasonable simulated value for different parameters
        isSimulated = true;
        value = generateSimulatedValue(sensor.parameter?.name);
        console.log(`Station ${station.id} (${station.name || 'unknown'}) generated simulated data: ${sensor.parameter?.name} = ${value}`);
      }
      
      if (value !== null) {
        sensorsProcessed++;
        
        // check if the data of this hour already exists
        const existingRecord = await collections.measurementCollection.findOne({
          station: station._id,
          'parameter.name': sensor.parameter.name,
          timestamp: currentTime
        });
        
        if (!existingRecord) {
          // store the hourly data
          await collections.measurementCollection.insertOne({
            station: station._id,
            parameter: {
              id: sensor.parameter.id,
              name: sensor.parameter.name,
              units: sensor.parameter.units,
              displayName: sensor.parameter.displayName
            },
            value: value,
            isSimulated: isSimulated,
            timestamp: currentTime,
            createdAt: new Date()
          });
          console.log(`Saved the data of ${sensor.parameter.name} of station ${station.name || station.id}: ${value}${isSimulated ? ' (simulated)' : ' (real)'}`);
          stationDataUpdated = true;
          recordsCreated++;
        } else {
          console.log(`The data of ${sensor.parameter.name} of station ${station.name || station.id} already exists, skipping`);
        }
        
        // update the latest value of the sensor
        await collections.sensorCollection.updateOne(
          { _id: sensor._id },
          { $set: { 
            value: value,
            lastUpdated: new Date(),
            isSimulated: isSimulated
          }}
        );
        console.log(`Updated the latest value of the sensor ${sensor.parameter.name} of station ${station.name || station.id}: ${value}`);
      }
    }
    
    if (stationDataUpdated) {
      // update the last update time of the station
      await collections.stationCollection.updateOne(
        { _id: station._id },
        { $set: { lastDataUpdate: new Date() } }
      );
    }
    
    return { 
      success: stationDataUpdated, 
      reason: stationDataUpdated ? 'success' : 'no_new_data',
      sensorsProcessed,
      recordsCreated
    };
  } catch (err) {
    console.error(`Error processing station ${station.name || station.id}:`, err);
    return { success: false, reason: 'error', error: err.message };
  }
}

// Lambda handler function
exports.handler = async (event) => {
  console.log(`Starting to collect air quality data in Los Angeles... (version ${LAMBDA_VERSION})`);
  console.log('Event trigger information:', JSON.stringify(event, null, 2));
  
  const startTime = new Date();
  
  // get the keys from the environment variables
  const MONGO_URI = process.env.MONGO_URI;
  const OPENAQ_API_KEY = process.env.OPENAQ_API_KEY;
  
  // get the paging configuration from the environment variables (default value if not set)
  const MAX_STATIONS_PER_RUN = parseInt(process.env.MAX_STATIONS_PER_RUN || '50', 10);
  const STATIONS_OFFSET = parseInt(process.env.STATIONS_OFFSET || '0', 10);
  
  console.log(`Configuration: Process up to ${MAX_STATIONS_PER_RUN} stations at a time, starting from the ${STATIONS_OFFSET}th station`);
  
  // validate the environment variables
  if (!MONGO_URI || !OPENAQ_API_KEY) {
    console.error('Error: Missing necessary environment variables MONGO_URI or OPENAQ_API_KEY');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Configuration error', message: 'Missing necessary environment variables' })
    };
  }
  
  // if the API key is provided, display part of it for verification
  if (OPENAQ_API_KEY.length > 8) {
    const keyStart = OPENAQ_API_KEY.substring(0, 4);
    const keyEnd = OPENAQ_API_KEY.substring(OPENAQ_API_KEY.length - 4);
    console.log(`Using API key: ${keyStart}...${keyEnd}`);
  }
  
  // connect to MongoDB
  let client;
  try {
    client = new MongoClient(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    
    console.log('Connecting to MongoDB...');
    await client.connect();
    console.log('Successfully connected to MongoDB');
    
    const db = client.db();
    const collections = {
      stationCollection: db.collection('stations'),
      sensorCollection: db.collection('sensors'),
      measurementCollection: db.collection('hourlymeasurements'),
      progressCollection: db.collection('lambjobprogress')
    };
    
    // get all stations in Los Angeles
    const query = {
      'coordinates.latitude': { $gte: LA_BOUNDS.minLat, $lte: LA_BOUNDS.maxLat },
      'coordinates.longitude': { $gte: LA_BOUNDS.minLng, $lte: LA_BOUNDS.maxLng }
    };
    
    console.log('Querying stations in Los Angeles:', JSON.stringify(query, null, 2));
    const allLaStations = await collections.stationCollection.find(query).toArray();
    
    console.log(`Found ${allLaStations.length} stations in Los Angeles`);
    
    if (allLaStations.length === 0) {
      console.warn('No stations found in Los Angeles, please check the database');
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          message: 'No stations found in Los Angeles, please check the database',
          timestamp: new Date().toISOString()
        })
      };
    }
    
    // apply the paging logic
    const totalStations = allLaStations.length;
    const endOffset = Math.min(STATIONS_OFFSET + MAX_STATIONS_PER_RUN, totalStations);
    const laStations = allLaStations.slice(STATIONS_OFFSET, endOffset);
    
    console.log(`This run processes stations ${STATIONS_OFFSET + 1} to ${endOffset}, a total of ${laStations.length} stations`);
    
    // align to the whole hour
    const currentTime = new Date();
    currentTime.setMinutes(0, 0, 0);
    
    // process the results statistics
    const results = {
      total: laStations.length, // Note: This is now only the number of stations processed in this run
      successful: 0,
      failed: 0,
      failureReasons: {},
      sensorsProcessed: 0,
      recordsCreated: 0,
      // 新增：分页信息
      paging: {
        totalStations,
        processedOffset: STATIONS_OFFSET,
        processedCount: laStations.length,
        remainingStations: totalStations - endOffset,
        isComplete: endOffset >= totalStations
      }
    };
    
    // process the stations in batches, reduce the number of stations per batch and increase the delay between batches
    const batchSize = 3; // reduce from 10 to 3 stations per batch
    for (let i = 0; i < laStations.length; i += batchSize) {
      const batchStations = laStations.slice(i, i + batchSize);
      const batchNumber = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(laStations.length/batchSize);
      console.log(`Processing batch ${batchNumber}/${totalBatches}, a total of ${batchStations.length} stations`);
      
      // process the stations of the current batch one by one, not in parallel
      const batchResults = [];
      for (const station of batchStations) {
        // add a small delay between stations
        if (batchStations.indexOf(station) > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        const result = await processStation(station, OPENAQ_API_KEY, collections, currentTime);
        batchResults.push(result);
      }
      
      // process the results of the current batch
      for (const result of batchResults) {
        if (result.success) {
          results.successful++;
          results.sensorsProcessed += result.sensorsProcessed || 0;
          results.recordsCreated += result.recordsCreated || 0;
        } else {
          results.failed++;
          const reason = result.reason || 'unknown';
          results.failureReasons[reason] = (results.failureReasons[reason] || 0) + 1;
        }
      }
      
      // add a longer delay between batches to avoid triggering API limits
      if (i + batchSize < laStations.length) {
        console.log('Batch processing interval...');
        const batchDelaySeconds = 8; // increase to 8 seconds
        console.log(`Waiting ${batchDelaySeconds} seconds...`);
        await new Promise(resolve => setTimeout(resolve, batchDelaySeconds * 1000));
      }
      
      // update the progress information to the database
      await collections.progressCollection.updateOne(
        { _id: 'LA_HOURLY_SYNC' },
        { 
          $set: { 
            lastRunTime: new Date(),
            lastOffset: STATIONS_OFFSET,
            nextOffset: endOffset >= totalStations ? 0 : endOffset, // 如果完成了所有站点，重置为0
            totalStations,
            batchesCompleted: batchNumber,
            totalBatches: Math.ceil(totalStations/batchSize),
            isFullyComplete: endOffset >= totalStations
          }
        },
        { upsert: true }
      );
    }
    
    const endTime = new Date();
    const executionTime = (endTime - startTime) / 1000; // 秒
    
    console.log(`✅ Los Angeles data collection completed. Success: ${results.successful} stations, Failed: ${results.failed} stations`);
    console.log(`Processed ${results.sensorsProcessed} sensors, created ${results.recordsCreated} new records`);
    console.log(`Execution time: ${executionTime.toFixed(2)} seconds`);
    
    if (results.failed > 0) {
      console.log('Failure reason statistics:', results.failureReasons);
    }
    
    // display the information for the next run
    if (results.paging.remainingStations > 0) {
      console.log(`Note: There are ${results.paging.remainingStations} stations remaining to be processed, please set STATIONS_OFFSET to ${endOffset} for the next run`);
    } else {
      console.log('All stations have been processed, the next run will start from the beginning');
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Los Angeles data collection completed successfully', 
        timestamp: new Date().toISOString(),
        version: LAMBDA_VERSION,
        executionTime: `${executionTime.toFixed(2)} seconds`,
        stats: results
      })
    };
    
  } catch (error) {
    console.error('Execution error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Data collection failed', 
        message: error.message,
        timestamp: new Date().toISOString(),
        version: LAMBDA_VERSION
      })
    };
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}; 