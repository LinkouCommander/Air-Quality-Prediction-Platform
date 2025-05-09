// models/Measurement.js
import mongoose from 'mongoose';

const measurementSchema = new mongoose.Schema({
    sensor: { type: mongoose.Schema.Types.ObjectId, ref: 'Sensor', required: true },  // 與 Sensor 關聯
    value: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },  // collect timestamp
}, {
    timestamps: true
});

export default mongoose.model('Measurement', measurementSchema);