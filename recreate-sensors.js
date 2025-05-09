import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB连接
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('错误: 环境变量MONGO_URI未设置');
  process.exit(1);
}

// 定义模型
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
    console.log('已连接到MongoDB');
    
    // 步骤1: 删除所有传感器记录
    console.log('正在删除所有传感器...');
    const deleteResult = await Sensor.deleteMany({});
    console.log(`已删除 ${deleteResult.deletedCount} 个传感器`);
    
    // 步骤2: 清空所有站点的sensors数组
    console.log('正在清空站点的传感器引用...');
    await Station.updateMany({}, { $set: { sensors: [] } });
    
    // 步骤3: 获取所有站点
    const stations = await Station.find({});
    console.log(`找到 ${stations.length} 个站点，开始创建传感器...`);
    
    // 常用参数类型
    const parameterTypes = [
      { name: 'pm25', displayName: 'PM2.5', units: 'µg/m³', id: 1 },
      { name: 'pm10', displayName: 'PM10', units: 'µg/m³', id: 2 },
      { name: 'temperature', displayName: '温度', units: '°C', id: 3 },
      { name: 'no2', displayName: '二氧化氮', units: 'ppm', id: 4 },
      { name: 'pm1', displayName: 'PM1.0', units: 'µg/m³', id: 5 },
      { name: 'relativehumidity', displayName: '相对湿度', units: '%', id: 6 },
      { name: 'um003', displayName: '超细颗粒物', units: '个/cm³', id: 7 }
    ];
    
    let sensorsCreated = 0;
    let stationsUpdated = 0;
    
    // 步骤4: 为每个站点创建传感器
    for (const station of stations) {
      const sensorIds = [];
      
      // 为站点创建所有类型的传感器
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
          console.log(`已创建 ${sensorsCreated} 个传感器...`);
        }
      }
      
      // 更新站点的sensors数组
      station.sensors = sensorIds;
      await station.save();
      stationsUpdated++;
      
      if (stationsUpdated % 50 === 0) {
        console.log(`已处理 ${stationsUpdated}/${stations.length} 个站点`);
      }
    }
    
    console.log(`\n操作完成! 创建了 ${sensorsCreated} 个传感器，更新了 ${stationsUpdated} 个站点`);
    
    // 统计
    const sensorCount = await Sensor.countDocuments();
    const measurementCount = await HourlyMeasurement.countDocuments();
    console.log(`数据库统计: ${sensorCount} 个传感器, ${measurementCount} 条测量记录`);
    
  } catch (error) {
    console.error('错误:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB连接已关闭');
  }
}

recreateSensors(); 