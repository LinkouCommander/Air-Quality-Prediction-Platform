import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('Error: The environment variable MONGO_URI is not set');
  process.exit(1);
}

// Define the models
const StationSchema = new mongoose.Schema({
  id: String,
  name: String,
  coordinates: {
    latitude: Number,
    longitude: Number
  },
  sensors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Sensor' }]
});

const SensorSchema = new mongoose.Schema({
  id: String,
  name: String,
  parameter: {
    id: Number,
    name: String,
    units: String,
    displayName: String
  },
  station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' },
  currentValue: Number,
  lastUpdated: Date
});

const HourlyMeasurementSchema = new mongoose.Schema({
  sensor: { type: mongoose.Schema.Types.ObjectId, ref: 'Sensor' },
  station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' },
  value: Number,
  timestamp: Date
});

const Station = mongoose.model('Station', StationSchema);
const Sensor = mongoose.model('Sensor', SensorSchema);
const HourlyMeasurement = mongoose.model('HourlyMeasurement', HourlyMeasurementSchema);

async function recreateSensors() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Step 1: Delete all sensor records
    console.log('Deleting all sensor records...');
    const deleteResult = await Sensor.deleteMany({});
    console.log(`Deleted ${deleteResult.deletedCount} sensors`);
    
    // Step 2: Clear all the sensors of the stations
    console.log('Clearing the sensors of the stations...');
    await Station.updateMany({}, { $set: { sensors: [] } });
    
    // Step 3: Get all stations
    const stations = await Station.find({});
    console.log(`Found ${stations.length} stations, starting to create sensors...`);
    
    // Common parameter types
    const parameterTypes = [
      { name: 'pm25', displayName: 'PM2.5', units: 'µg/m³', id: 1 },
      { name: 'pm10', displayName: 'PM10', units: 'µg/m³', id: 2 },
      { name: 'temperature', displayName: 'Temperature', units: '°C', id: 3 },
      { name: 'no2', displayName: 'NO2', units: 'ppm', id: 4 },
      { name: 'pm1', displayName: 'PM1.0', units: 'µg/m³', id: 5 },
      { name: 'relativehumidity', displayName: 'Relative Humidity', units: '%', id: 6 },
      { name: 'um003', displayName: 'Ultrafine Particles', units: '个/cm³', id: 7 }
    ];
    
    let sensorsCreated = 0;
    let stationsUpdated = 0;
    
    // Step 4: Create sensors for each station
    for (const station of stations) {
      const sensorIds = [];
      
      // Create sensors for all types of parameters for the station
      for (const param of parameterTypes) {
        const sensor = new Sensor({
          id: `${station.id}_${param.name}`,
          name: `${station.name} ${param.displayName}`,
          parameter: param,
          station: station._id,
          currentValue: null,
          lastUpdated: new Date()
        });
        
        await sensor.save();
        sensorIds.push(sensor._id);
        sensorsCreated++;
        
        if (sensorsCreated % 100 === 0) {
          console.log(`Created ${sensorsCreated} sensors...`);
        }
      }
      
      // Update the sensors array of the station
      station.sensors = sensorIds;
      await station.save();
      stationsUpdated++;
      
      if (stationsUpdated % 50 === 0) {
        console.log(`Processed ${stationsUpdated}/${stations.length} stations`);
      }
    }
    
    console.log(`\nOperation completed! Created ${sensorsCreated} sensors, updated ${stationsUpdated} stations`);
    
    // Statistics
    const sensorCount = await Sensor.countDocuments();
    const measurementCount = await HourlyMeasurement.countDocuments();
    console.log(`Database statistics: ${sensorCount} sensors, ${measurementCount} measurements`);
    
  } catch (error) {
      console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

recreateSensors(); 