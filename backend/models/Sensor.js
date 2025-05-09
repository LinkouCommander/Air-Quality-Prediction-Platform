// models/Sensor.js
import mongoose from 'mongoose';
// import Measurement from './models/Measurement.js';

const sensorSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: String,
    parameter: {
        id: { type: Number, required: true },
        name: String,
        units: String,
        displayName: String,
    },
    value: { type: Number, default: -1 },  // latest value
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' },  // relate to Station
}, {
    timestamps: true
});

export default mongoose.model('Sensor', sensorSchema);