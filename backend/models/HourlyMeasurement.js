import mongoose from 'mongoose';

const hourlyMeasurementSchema = new mongoose.Schema({
  station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
  parameter: {
    id: Number,
    name: String,
    units: String,
    displayName: String
  },
  value: { type: Number, required: true },
  timestamp: { type: Date, required: true }, // 每小时的时间戳
}, {
  timestamps: true // 创建和更新时间
});

// 创建复合索引，用于快速查询特定时间和站点的数据
hourlyMeasurementSchema.index({ station: 1, timestamp: 1 });
hourlyMeasurementSchema.index({ timestamp: 1 });
hourlyMeasurementSchema.index({ 'parameter.name': 1 });
// 空间索引，用于查询特定区域内的数据
hourlyMeasurementSchema.index({ 'station': 1, 'timestamp': 1, 'parameter.name': 1 });

// 添加一个安全的findOneByTime方法，确保排序总是使用简单的字段方式
hourlyMeasurementSchema.statics.findOneByTime = async function(query) {
  try {
    // 应用一个简单安全的排序，避免使用$expr表达式
    return await this.findOne(query).sort({ timestamp: -1 }).exec();
  } catch (error) {
    console.error('MongoDB查询出错:', error);
    // 如果出错，尝试不带排序的查询
    try {
      return await this.findOne(query).exec();
    } catch (fallbackError) {
      console.error('备用查询也失败:', fallbackError);
      throw new Error('数据库查询失败: ' + error.message);
    }
  }
};

export default mongoose.model('HourlyMeasurement', hourlyMeasurementSchema); 