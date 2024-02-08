import mongoose from 'mongoose';
import { DB_NAME } from '../constants.js';

const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);
        console.log("DB connection response",connectionInstance);
    } catch (error) {
        console.log("Mongodb connection error", error);
        //throw error;
        process.exit(1);
    }
}

export default connectDB;