// cleanLA.js
// clean the data in MongoDB that is not in the Los Angeles area

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Station from './models/Station.js';
import Sensor from './models/Sensor.js';
import Measurement from './models/Measurement.js';
import HourlyMeasurement from './models/HourlyMeasurement.js';

// get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// try to load the .env file
console.log('try to load the .env file...');
const envPaths = [
  path.join(rootDir, '.env'),        // the root directory
  path.join(__dirname, '.env'),      // the backend directory
  path.join(process.cwd(), '.env')   // the current working directory
];

let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    console.log(`find the .env file: ${envPath}`);
    dotenv.config({ path: envPath });
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  console.log('warning: .env file not found');
}

// check the environment variable
if (process.env.MONGO_URI) {
  console.log('successfully load the MONGO_URI environment variable');
} else {
  console.log('failed to load the MONGO_URI environment variable');
}

// manually set the MongoDB connection URI (if the environment variable does not exist)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/airquality';

console.log(`use the MongoDB connection: ${MONGO_URI.substring(0, MONGO_URI.indexOf('@') > 0 ? MONGO_URI.indexOf('@') : 20)}...`);

// the geographical boundaries of the Los Angeles area
const LA_BOUNDS = {
  minLat: 33.6, // the southern boundary
  maxLat: 34.8, // the northern boundary
  minLng: -118.9, // the western boundary
  maxLng: -117.5 // the eastern boundary
};

// the main function
async function cleanupLA() {
  try {
    console.log('connecting to MongoDB...');
    
    // connect to MongoDB
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('successfully connect to MongoDB');
    
    // find all the stations that are not in the Los Angeles area
    const nonLAStations = await Station.find({
      $or: [
        { 'coordinates.latitude': { $lt: LA_BOUNDS.minLat } },
        { 'coordinates.latitude': { $gt: LA_BOUNDS.maxLat } },
        { 'coordinates.longitude': { $lt: LA_BOUNDS.minLng } },
        { 'coordinates.longitude': { $gt: LA_BOUNDS.maxLng } }
      ]
    });
    
    if (nonLAStations.length === 0) {
      console.log('no stations found that are not in the Los Angeles area, no need to clean');
      await mongoose.connection.close();
      return;
    }
    
    console.log(`find ${nonLAStations.length} stations that are not in the Los Angeles area, ready to delete...`);
    
    // collect the station IDs and sensor IDs
    const stationIds = nonLAStations.map(station => station._id);
    const sensorIds = [];
    
    for (const station of nonLAStations) {
      if (station.sensors && station.sensors.length > 0) {
        sensorIds.push(...station.sensors);
      }
    }
    
    // delete the related hourly measurements
    const hourlyResult = await HourlyMeasurement.deleteMany({
      station: { $in: stationIds }
    });
    console.log(`deleted ${hourlyResult.deletedCount} hourly measurements`);
    
    // delete the related measurements
    const measurementResult = await Measurement.deleteMany({
      station: { $in: stationIds }
    });
    console.log(`deleted ${measurementResult.deletedCount} measurements`);
    
    // delete the related sensors
    const sensorResult = await Sensor.deleteMany({
      _id: { $in: sensorIds }
    });
    console.log(`deleted ${sensorResult.deletedCount} sensors`);
    
    // delete the stations that are not in the Los Angeles area
    const stationResult = await Station.deleteMany({
      _id: { $in: stationIds }
    });
    console.log(`deleted ${stationResult.deletedCount} stations`);
    
    // check the remaining stations
    const remainingCount = await Station.countDocuments();
    console.log(`there are ${remainingCount} stations left in the database (all in the Los Angeles area)`);
    
    // close the database connection
    await mongoose.connection.close();
    console.log('successfully close the database connection');
    
    console.log('successfully complete the operation: only the stations in the Los Angeles area are kept in the MongoDB');
    
  } catch (error) {
    console.error('error:', error);
    
    // ensure to close the database connection
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log('successfully close the database connection');
    }
  }
}

// execute the cleanup
cleanupLA(); 