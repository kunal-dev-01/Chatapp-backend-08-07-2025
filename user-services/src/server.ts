import dotenv from "dotenv";
import express from "express";
import cookieParser from "cookie-parser";
import connectDB from "./config/connectDB";

const PORT = process.env.PORT || 3000;


dotenv.config();

const app = express();

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

connectDB();


import authRouter from "./routes/auth.route.js";

// Routes - COMMENT THESE OUT
app.use('/api/v1/auth', authRouter);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'User Service is running!',
    port: PORT,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});