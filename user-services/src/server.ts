import dotenv from "dotenv";
import express from "express";
import connectDB from "./config/connectDB";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

connectDB();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});