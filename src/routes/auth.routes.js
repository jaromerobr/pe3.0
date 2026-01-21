import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';

async function authRoutes(fastify, options) {
    // Ruta de login
    fastify.post('/register', async (request, reply) => {
        const { username, password, role } = request.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        try {
            const [result] = await pool.query(
                'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
                [username, hashedPassword, role || 'user']
            );
            reply.send({ id: result.insertId, username, role: role || 'user' });
        }
        catch (error) {
            reply.status(500).send({ error: 'Database error', message: error.message });
        }   
    });



    fastify.post('/login', async (request, reply) => {
        const { username, password } = request.body;    
        try {
            const [rows] = await pool.query(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );
            if (rows.length === 0) {
                return reply.status(401).send({ error: 'Invalid credentials' });
            }
            const user = rows[0];
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return reply.status(401).send({ error: 'Invalid credentials' });
            }
            const token = fastify.jwt.sign({ id: user.id, username: user.username, role: user.role });
            reply.send({ token });
        } catch (error) {
            reply.status(500).send({ error: 'Database error', message: error.message });
        }
    });
}

export default authRoutes;