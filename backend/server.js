import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Station from './models/Station.js';
import Sensor from './models/Sensor.js';
import Measurement from './models/Measurement.js';
import HourlyMeasurement from './models/HourlyMeasurement.js';
import { startDataCollection, collectDataOnce, populateHistoricalData } from './services/dataCollectionService.js';
import { predictAirQuality } from './services/predictionService.js';

// Load environment variables
dotenv.config();

// set the default port
const PORT = process.env.PORT || 8080;
// set the OpenAQ API key
const OPENAQ_API_KEY = process.env.OPENAQ_API_KEY || '576b406d4511124ead07e207089cea54fb533f52d9a7fa993785c2ea80b589e6';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://guest:81cYPEHlXeEYRC7s@airquality-db.hxjezfz.mongodb.net/air-quality?retryWrites=true&w=majority&appName=airquality-db';

const app = express();

// Configure CORS
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Parse JSON request body
app.use(express.json());

console.log('Attempting to connect to MongoDB...');
console.log('Using MONGO_URI:', MONGO_URI.substring(0, 25) + '...');

// Connect to MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  // below options can solve some query compatibility problems
  serverSelectionTimeoutMS: 5000, // out of time
  heartbeatFrequencyMS: 1000,     // heartbeat frequency
  socketTimeoutMS: 30000,         // Socket out of time
})
.then(() => {
  console.log('MongoDB Connected Successfully');
  initStations();
  // start data collection service
  startDataCollection();
  // collect data once
  collectDataOnce();
  // check and populate historical data
  checkAndPopulateHistoricalData();
})
.catch(err => {
  console.error('MongoDB Connection Error:', err);
  console.error('MongoDB connection failed, but the server will continue running');
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend API server running normally!' });
});

// Initialize stations on first server start and save to database
async function initStations() {
  try {
    const existingStations = await Station.find();
    if (existingStations.length > 0) {
      console.log('Stations already exist, skipping initialization');
      return;
    }

    console.log('📦 Initializing station data...');

    const response = await fetch('https://api.openaq.org/v3/locations?limit=500&coordinates=34.0522,-118.2437&radius=25000', {
      headers: {
        'X-API-Key': OPENAQ_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('OpenAQ API error');
      return;
    }

    const data = await response.json();
    const station_list = [];

    for (const st of data.results) {
      const station = {
        id: st.id,
        name: st.name,
        sensors: [],
        coordinates: {
          latitude: st.coordinates.latitude,
          longitude: st.coordinates.longitude
        }
      };

      for (const ss of st.sensors) {
        let sensor = await Sensor.findOne({ id: ss.id });
        if (sensor) continue;

        sensor = new Sensor({
          id: ss.id,
          name: ss.name,
          parameter: {
            id: ss.parameter.id,
            name: ss.parameter.name,
            units: ss.parameter.units,
            displayName: ss.parameter.displayName
          },
        });
        await sensor.save();
        console.log(`✅ Sensor saved: ${sensor._id}`);
        station.sensors.push(sensor._id);
      }
      station_list.push(station);
    }

    const savedStations = await Station.insertMany(station_list);
    for (let i = 0; i < savedStations.length; i++) {
      const station = savedStations[i];
      // Update the station reference in sensor documents
      await Sensor.updateMany(
        { _id: { $in: station.sensors } },
        { $set: { station: station._id } }
      );
    }

    console.log(`Saved ${savedStations.length} stations`);
  } catch (err) {
    console.error('Failed to initialize stations:', err);
  }
}

// API: Get all stations
app.get('/api/stations', async (req, res) => {
  try {
    console.log("Received station information request...");
    
    // Try to get data from database
    let stations = [];
    try {
      stations = await Station.find().populate('sensors');
      console.log(`Retrieved ${stations.length} stations from database`);
    } catch (dbErr) {
      console.error("Database query error:", dbErr);
      stations = getMockStations();
      console.log("Using mock data instead of database data");
    }

    // If no data, use mock data
    if (!stations || stations.length === 0) {
      stations = getMockStations();
      console.log("No database data, using mock data");
    }

    res.status(200).json(stations);
  } catch (err) {
    console.error("API error:", err);
    // Return mock data on error
    const mockStations = getMockStations();
    res.status(200).json(mockStations);
  }
});

// API: Get area statistics for stations in a region
app.post('/api/area-stats', async (req, res) => {
  try {
    console.log("Received area statistics request...");
    const { minLat, maxLat, minLng, maxLng } = req.body;
    
    if (!minLat || !maxLat || !minLng || !maxLng) {
      return res.status(400).json({ error: "Missing required latitude/longitude parameters" });
    }
    
    console.log(`Query area: Latitude ${minLat}-${maxLat}, Longitude ${minLng}-${maxLng}`);
    
    // Query all stations in the given area
    const stations = await Station.find({
      'coordinates.latitude': { $gte: minLat, $lte: maxLat },
      'coordinates.longitude': { $gte: minLng, $lte: maxLng }
    }).populate('sensors');
    
    console.log(`Found ${stations.length} stations in the area`);
    
    if (stations.length === 0) {
      return res.status(200).json({
        minLat, maxLat, minLng, maxLng,
        stationCount: 0,
        averages: {
          pm25: null,
          pm10: null,
          o3: null,
          no2: null,
          so2: null,
          co: null
        },
        counts: {
          pm25: 0,
          pm10: 0,
          o3: 0,
          no2: 0,
          so2: 0,
          co: 0
        }
      });
    }
    
    // Calculate averages
    const parameters = ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co'];
    const sums = {};
    const counts = {};
    
    // Initialize
    parameters.forEach(param => {
      sums[param] = 0;
      counts[param] = 0;
    });
    
    // Calculate sums and counts
    stations.forEach(station => {
      parameters.forEach(param => {
        // Find sensor
        const sensor = station.sensors?.find(s => s.parameter?.name === param);
        if (sensor && sensor.value !== undefined && sensor.value !== null) {
          sums[param] += parseFloat(sensor.value);
          counts[param]++;
        }
      });
    });
    
    // Calculate averages
    const averages = {};
    parameters.forEach(param => {
      averages[param] = counts[param] > 0 ? sums[param] / counts[param] : null;
    });
    
    // Return results
    res.status(200).json({
      minLat, maxLat, minLng, maxLng,
      stationCount: stations.length,
      averages,
      counts
    });
    
  } catch (err) {
    console.error("Error calculating area statistics:", err);
    res.status(500).json({ error: "Unable to calculate area statistics" });
  }
});

// Function to generate mock data
function getMockStations() {
  console.log("Generating mock station data...");
  return [
    {
      id: "mock1",
      name: "Downtown Los Angeles",
      coordinates: {
        latitude: 34.052235,
        longitude: -118.243683
      },
      sensors: [
        { 
          parameter: { name: "pm25", units: "µg/m³", displayName: "PM2.5" },
          value: 15.2
        },
        { 
          parameter: { name: "pm10", units: "µg/m³", displayName: "PM10" },
          value: 35.7
        },
        { 
          parameter: { name: "o3", units: "ppb", displayName: "Ozone" },
          value: 28.4
        }
      ]
    },
    {
      id: "mock2",
      name: "Hollywood",
      coordinates: {
        latitude: 34.092809,
        longitude: -118.328661
      },
      sensors: [
        { 
          parameter: { name: "pm25", units: "µg/m³", displayName: "PM2.5" },
          value: 12.8
        },
        { 
          parameter: { name: "pm10", units: "µg/m³", displayName: "PM10" },
          value: 29.4
        },
        { 
          parameter: { name: "o3", units: "ppb", displayName: "Ozone" },
          value: 31.2
        }
      ]
    }
  ];
}

// API: get the station data at a specific time
app.post('/api/stations/at-time', async (req, res) => {
  try {
    console.log("Received time query station data request:", req.body);
    const { timestamp } = req.body;
    
    if (!timestamp) {
      console.log("Request missing the necessary timestamp parameter");
      return res.status(400).json({ error: "Missing the necessary timestamp parameter" });
    }
    
    const queryTime = new Date(timestamp);
    console.log(`Query time: ${queryTime.toISOString()}`);
    
    // use the efficient aggregation pipeline to directly get the station data and the latest data
    const pipeline = [
      // stage 1: get all station basic information from the station table
      {
        $lookup: {
          from: "sensors", // sensor collection name
          localField: "sensors",
          foreignField: "_id",
          as: "sensorDetails"
        }
      },
      // stage 2: find the latest hourly data for each station
      {
        $lookup: {
          from: "hourlymeasurements", // measurement collection name
          let: { stationId: "$_id", sensorIds: "$sensors" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$station", "$$stationId"] },
                    { $lte: ["$timestamp", queryTime] }
                  ]
                }
              }
            },
            { $sort: { timestamp: -1 } }, // sort by time in descending order
            {
              $group: {
                _id: "$parameter.name", // group by parameter name
                value: { $first: "$value" }, // get the latest value of each parameter
                units: { $first: "$parameter.units" },
                displayName: { $first: "$parameter.displayName" },
                parameterId: { $first: "$parameter.id" }
              }
            }
          ],
          as: "measurements"
        }
      },
      // stage 3: project the output fields we need
      {
        $project: {
          id: 1,
          name: 1,
          coordinates: 1,
          sensorDetails: 1,
          measurements: 1
        }
      }
    ];
    
    // execute the aggregation pipeline
    const aggregationResult = await Station.aggregate(pipeline);
    
    if (!aggregationResult || aggregationResult.length === 0) {
      console.log("No station data in the database, using mock data");
      return res.status(200).json(getMockStations());
    }

    console.log(`Got ${aggregationResult.length} stations data`);
    
    // convert the aggregation result to the frontend required format
    const stationsData = aggregationResult.map(station => {
      // build the station basic information
      const stationData = {
        id: station.id,
        name: station.name,
        coordinates: station.coordinates,
        sensors: []
      };
      
      // create a mapping from sensor parameter name to sensor object
      const sensorMap = {};
      station.sensorDetails.forEach(sensor => {
        if (sensor.parameter && sensor.parameter.name) {
          sensorMap[sensor.parameter.name] = sensor;
        }
      });
      
      // process the measurement results, fill the sensor data
      station.measurements.forEach(measurement => {
        const paramName = measurement._id;
        const sensor = sensorMap[paramName];
        
        if (sensor) {
          stationData.sensors.push({
            id: sensor.id,
            parameter: {
              id: measurement.parameterId || sensor.parameter.id,
              name: paramName,
              units: measurement.units || sensor.parameter.units || "µg/m³",
              displayName: measurement.displayName || sensor.parameter.displayName || paramName
            },
            value: measurement.value
          });
        }
      });
      
      // for sensors without measurement data, add a randomly generated value
      station.sensorDetails.forEach(sensor => {
        // check if this sensor already has measurement data
        if (sensor.parameter && sensor.parameter.name) {
          const paramName = sensor.parameter.name;
          const hasData = stationData.sensors.some(s => s.parameter.name === paramName);
          
          if (!hasData) {
            // generate a random reasonable value
            const randomValue = getRandomValueForParameter(paramName);
            
            stationData.sensors.push({
              id: sensor.id,
              parameter: {
                id: sensor.parameter.id,
                name: paramName,
                units: sensor.parameter.units || "µg/m³",
                displayName: sensor.parameter.displayName || paramName
              },
              value: randomValue
            });
          }
        }
      });
      
      // only return the stations with sensor data
      return stationData.sensors.length > 0 ? stationData : null;
    }).filter(station => station !== null);
    
    res.status(200).json(stationsData);
  } catch (err) {
    console.error('Time query station API error:', err);
    console.error('Error stack:', err.stack);
    
    // when error occurs, use mock data
    console.log("API error, using mock data");
    res.status(200).json(getMockStations());
  }
});

// helper function to generate a random reasonable value for a parameter
function getRandomValueForParameter(paramName) {
  const ranges = {
    'pm25': { min: 5, max: 75 },
    'pm10': { min: 10, max: 150 },
    'o3': { min: 20, max: 65 },
    'no2': { min: 10, max: 45 },
    'so2': { min: 5, max: 20 },
    'co': { min: 0.4, max: 4.0 }
  };
  
  const range = ranges[paramName] || { min: 0, max: 100 };
  return parseFloat((Math.random() * (range.max - range.min) + range.min).toFixed(1));
}

// predict air quality
app.post('/api/predict', async (req, res) => {
  try {
    console.log("Received prediction request:", req.body);
    const { latitude, longitude, timestamp, parameter, radius } = req.body;
    
    if (!latitude || !longitude) {
      console.log("Prediction request missing required parameters");
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters: latitude, longitude' 
      });
    }
    
    // default use current time if not specified
    const predictionTime = timestamp ? new Date(timestamp) : new Date();
    console.log(`Using prediction time: ${predictionTime.toISOString()}`);
    
    // output prediction parameters
    console.log(`Prediction parameters: coordinates(${latitude}, ${longitude}), parameter:${parameter || 'pm25'}, radius:${radius || 5}km`);
    
    // call prediction service, default radius is 5km
    try {
      // ensure all parameters are correct
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const rad = parseFloat(radius) || 5;
      
      if (isNaN(lat) || isNaN(lng) || isNaN(rad)) {
        console.error(`Parameter conversion error: latitude=${latitude}, longitude=${longitude}, radius=${radius}`);
        return res.status(400).json({ 
          success: false, 
          error: 'Coordinate or radius parameter format is incorrect'
        });
      }
      
      console.log(`Calling prediction function: latitude=${lat}, longitude=${lng}, radius=${rad}km`);
      const prediction = await predictAirQuality(
        lat, 
        lng, 
        predictionTime,
        parameter || 'pm25',
        rad
      );
      
      console.log("Prediction result:", prediction);
      res.status(200).json(prediction);
    } catch (predictionErr) {
      console.error('Prediction function execution error:', predictionErr);
      console.error('Error stack:', predictionErr.stack);
      res.status(500).json({ 
        success: false, 
        error: `Prediction process error: ${predictionErr.message}`,
        details: predictionErr.stack
      });
    }
  } catch (err) {
    console.error('Prediction API overall error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
      success: false, 
      error: `Server internal error: ${err.message}`, 
      details: err.stack
    });
  }
});

// 添加GET端点支持 (与POST端点类似)
app.get('/api/predict', async (req, res) => {
  try {
    console.log("Received GET prediction request:", req.query);
    const { latitude, longitude, timestamp, parameter, radius } = req.query;
    
    if (!latitude || !longitude) {
      console.log("Prediction request missing required parameters");
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters: latitude, longitude' 
      });
    }
    
    // default use current time if not specified
    const predictionTime = timestamp ? new Date(timestamp) : new Date();
    console.log(`Using prediction time: ${predictionTime.toISOString()}`);
    
    // output prediction parameters
    console.log(`Prediction parameters: coordinates(${latitude}, ${longitude}), parameter:${parameter || 'pm25'}, radius:${radius || 5}km`);
    
    // call prediction service, default radius is 5km
    try {
      // ensure all parameters are correct
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const rad = parseFloat(radius) || 5;
      
      if (isNaN(lat) || isNaN(lng) || isNaN(rad)) {
        console.error(`Parameter conversion error: latitude=${latitude}, longitude=${longitude}, radius=${radius}`);
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid parameters: latitude, longitude, or radius is not a valid number' 
        });
      }
      
      // 使用已导入的预测函数
      const predictionResult = await predictAirQuality(lat, lng, predictionTime, parameter, rad);
      return res.json(predictionResult);
    } catch (predictionError) {
      console.error("Prediction service error:", predictionError);
      return res.status(500).json({ 
        success: false, 
        error: `Error during prediction: ${predictionError.message}` 
      });
    }
  } catch (error) {
    console.error("GET API Error:", error);
    return res.status(500).json({ 
      success: false, 
      error: `Server error: ${error.message}` 
    });
  }
});


// manually trigger data collection API (for testing)
app.post('/api/collect-data', async (req, res) => {
  try {
    console.log("Manually trigger data collection...");
    const result = await collectDataOnce();
    if (result) {
      res.status(200).json({ 
        success: true, 
        message: 'Data collection successful' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Data collection failed' 
      });
    }
  } catch (err) {
    console.error('Data collection API error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server internal error' 
    });
  }
});

// API: get historical data
app.post('/api/historical-data', async (req, res) => {
  try {
    console.log("Received historical data request...");
    const { stationId, parameter, startTime, endTime } = req.body;
    
    if (!stationId || !parameter) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters: stationId, parameter' 
      });
    }
    
    // find station
    const station = await Station.findOne({ id: stationId });
    if (!station) {
      return res.status(404).json({ 
        success: false, 
        error: 'Station not found' 
      });
    }
    
    // build query conditions
    const query = {
      station: station._id,
      'parameter.name': parameter
    };
    
    // if time range is specified, add time condition
    if (startTime && endTime) {
      query.timestamp = {
        $gte: new Date(startTime),
        $lte: new Date(endTime)
      };
    }
    
    // query historical data
    const measurements = await HourlyMeasurement.find(query)
      .sort({ timestamp: 1 })
      .limit(100); // limit return quantity
    
    res.status(200).json({
      success: true,
      station: station.name,
      parameter: parameter,
      data: measurements.map(m => ({
        value: m.value,
        timestamp: m.timestamp,
        unit: m.parameter.units
      }))
    });
  } catch (err) {
    console.error('Historical data API error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server internal error' 
    });
  }
});

// check and populate historical data
async function checkAndPopulateHistoricalData() {
  try {
    // check if there are enough historical data
    const count = await HourlyMeasurement.countDocuments();
    console.log(`Database has ${count} hourly measurements`);
    
    if (count < 100) { // if data is insufficient, generate test data
      console.log('Historical data is insufficient, generating test data...');
      await populateHistoricalData();
    } else {
      console.log('Historical data is sufficient, no need to generate test data');
    }
  } catch (err) {
    console.error('Error checking historical data:', err);
  }
}

// 添加API端点来触发数据生成（用于测试）
app.post('/api/generate-data', async (req, res) => {
  try {
    console.log('Manually trigger data generation...');
    const result = await populateHistoricalData();
    if (result) {
      res.status(200).json({
        success: true,
        message: 'Historical data generation successful'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Historical data generation failed'
      });
    }
  } catch (err) {
    console.error('Data generation API error:', err);
    res.status(500).json({
      success: false,
      error: 'Server internal error'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});