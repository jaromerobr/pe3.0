import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

export async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connection established successfully.');
        connection.release();
    } catch (error) {
        console.error('❌ Error connecting to the database:', error);
        throw error; // Lanzamos el error para que startServer lo capture
    }
}