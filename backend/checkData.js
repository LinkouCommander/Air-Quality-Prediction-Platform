import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Station from './models/Station.js';
import Sensor from './models/Sensor.js';
import HourlyMeasurement from './models/HourlyMeasurement.js';

// load the environment variables
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('MongoDB connection string is not set, please check the .env file');
  process.exit(1);
}

console.log('Starting to connect to MongoDB...');

// connect to MongoDB
mongoose.connect(MONGO_URI)
.then(async () => {
  console.log('✅ MongoDB connection successful!');
  await checkDatabaseStatus();
  mongoose.connection.close();
})
.catch(err => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1);
});

// check the database status
async function checkDatabaseStatus() {
  try {
    console.log('📊 Starting to check the database status...');
    
    // get the number of stations
    const stationCount = await Station.countDocuments();
    console.log(`🏢 The number of monitoring stations: ${stationCount}`);
    
    // get the number of sensors
    const sensorCount = await Sensor.countDocuments();
    console.log(`🔌 The number of sensors: ${sensorCount}`);
    
    // get the number of measurements
    const measurementCount = await HourlyMeasurement.countDocuments();
    console.log(`📊 The number of hourly measurements: ${measurementCount}`);
    
    // get the earliest data time
    const earliestData = await HourlyMeasurement.findOne().sort({ timestamp: 1 });
    
    // get the latest data time
    const latestData = await HourlyMeasurement.findOne().sort({ timestamp: -1 });
    
    if (earliestData && latestData) {
      console.log(`⏰ The data time range: ${earliestData.timestamp.toISOString()} to ${latestData.timestamp.toISOString()}`);
      
      // calculate the number of hours covered by the data
      const hoursDiff = Math.floor((latestData.timestamp - earliestData.timestamp) / (1000 * 60 * 60)) + 1;
      console.log(`⌛ The data coverage time: ${hoursDiff} hours`);
      
      // count the data by parameter
      const parameters = await HourlyMeasurement.distinct('parameter.name');
      console.log(`🔍 The data includes the following parameter types: ${parameters.join(', ')}`);
      
      // count the data by parameter
      for (const param of parameters) {
        const count = await HourlyMeasurement.countDocuments({ 'parameter.name': param });
        console.log(`  - ${param}: ${count} data`);
      }
    } else {
      console.log('❌ There is no measurement data in the database');
    }
    
    // check if there are missing hours of data
    if (earliestData && latestData) {
      const startTime = new Date(earliestData.timestamp);
      const endTime = new Date(latestData.timestamp);
      
      // randomly select several stations and sensors for checking
      const sampleStations = await Station.aggregate([{ $sample: { size: 3 } }]);
      
      for (const station of sampleStations) {
        const sensors = await Sensor.find({ station: station._id });
        if (sensors.length === 0) continue;
        
        console.log(`\n🏢 Check the data integrity of station ${station.name}`);
        
        // select the first sensor
        const sensor = sensors[0];
        console.log(`🔌 Sensor: ${sensor.parameter?.name}`);
        
        // count the data by parameter
        const dataCount = await HourlyMeasurement.countDocuments({
          station: station._id,
          'parameter.name': sensor.parameter?.name
        });
        
        // calculate the theoretically expected data amount
        const expectedCount = Math.floor((endTime - startTime) / (1000 * 60 * 60)) + 1;
        
        console.log(`📊 Data integrity: ${dataCount}/${expectedCount} (${Math.round(dataCount/expectedCount*100)}%)`);
      }
    }
    
    console.log('\n✅ The database status check is completed');
    
  } catch (err) {
    console.error('❌ The database status check failed:', err);
  }
} 