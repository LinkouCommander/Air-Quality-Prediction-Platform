// models/Station.js
import mongoose from 'mongoose';

const stationSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: String,
    sensors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Sensor' }], // relate to Sensor
    coordinates: {
        latitude: Number,
        longitude: Number
    }, // [lng, lat]
}, {
    timestamps: true
});

stationSchema.index({ location: '2dsphere' }); // for geospatial queries

export default mongoose.model('Station', stationSchema);