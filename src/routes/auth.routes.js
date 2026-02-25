import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';
import { sendEmail } from '../services/email.service.js';

// Genera un código OTP de 6 dígitos
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function authRoutes(fastify, options) {

    // =========================================================================
    // POST /auth/register - Registrar nuevo usuario
    // =========================================================================
    fastify.post('/register', {
        schema: {
            description: 'Registrar un nuevo usuario en el sistema',
            tags: ['Auth'],
            body: {
                type: 'object',
                required: ['username', 'email', 'password'],
                properties: {
                    username: { type: 'string', description: 'Nombre de usuario único' },
                    email: { type: 'string', format: 'email', description: 'Correo electrónico' },
                    password: { type: 'string', description: 'Contraseña' },
                    role: { type: 'string', enum: ['admin', 'user'], default: 'user' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        id: { type: 'number' },
                        username: { type: 'string' },
                        email: { type: 'string' },
                        role: { type: 'string' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        const { username, email, password, role } = request.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        try {
            const [result] = await pool.query(
                'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
                [username, email, hashedPassword, role || 'user']
            );
            reply.send({ success: true, id: result.insertId, username, email, role: role || 'user' });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return reply.status(409).send({ success: false, error: 'El usuario o email ya existe' });
            }
            reply.status(500).send({ success: false, error: 'Database error', message: error.message });
        }
    });

    // =========================================================================
    // POST /auth/login - Paso 1: Verificar credenciales y enviar OTP por email
    // =========================================================================
    fastify.post('/login', {
        schema: {
            description: 'Iniciar sesión: verifica credenciales y envía código OTP al correo',
            tags: ['Auth'],
            body: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                    username: { type: 'string' },
                    password: { type: 'string' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                        userId: { type: 'number' },
                        emailHint: { type: 'string' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        const { username, password } = request.body;
        try {
            const [rows] = await pool.query(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );
            if (rows.length === 0) {
                return reply.status(401).send({ success: false, error: 'Credenciales inválidas' });
            }
            const user = rows[0];
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                return reply.status(401).send({ success: false, error: 'Credenciales inválidas' });
            }

            // Generar OTP y guardarlo en BD
            const otpCode = generateOTP();
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // Expira en 5 minutos

            // Invalidar OTPs anteriores del usuario
            await pool.execute(
                'UPDATE otp_codes SET used = TRUE WHERE user_id = ? AND used = FALSE',
                [user.id]
            );

            // Insertar nuevo OTP
            await pool.execute(
                'INSERT INTO otp_codes (user_id, code, expires_at) VALUES (?, ?, ?)',
                [user.id, otpCode, expiresAt]
            );

            // Enviar OTP por correo
            const emailHtml = `
                <h2>Código de verificación</h2>
                <p>Tu código OTP es: <strong>${otpCode}</strong></p>
                <p>Este código expira en 5 minutos.</p>
                <p>Si no solicitaste este código, ignora este mensaje.</p>
            `;
            await sendEmail(user.email, 'Código de Verificación - PE 3.1', emailHtml);

            // Ocultar parte del email para la respuesta
            const emailParts = user.email.split('@');
            const emailHint = emailParts[0].substring(0, 3) + '***@' + emailParts[1];

            reply.send({
                success: true,
                message: 'Código OTP enviado al correo electrónico',
                userId: user.id,
                emailHint
            });
        } catch (error) {
            reply.status(500).send({ success: false, error: 'Error del servidor', message: error.message });
        }
    });

    // =========================================================================
    // POST /auth/verify-otp - Paso 2: Verificar OTP y obtener JWT
    // =========================================================================
    fastify.post('/verify-otp', {
        schema: {
            description: 'Verificar el código OTP recibido por email y obtener token JWT',
            tags: ['Auth'],
            body: {
                type: 'object',
                required: ['userId', 'code'],
                properties: {
                    userId: { type: 'number', description: 'ID del usuario' },
                    code: { type: 'string', description: 'Código OTP de 6 dígitos' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                        token: { type: 'string' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        const { userId, code } = request.body;
        try {
            // Buscar OTP válido y no expirado
            const [otpRows] = await pool.execute(
                `SELECT * FROM otp_codes 
                 WHERE user_id = ? AND code = ? AND used = FALSE AND expires_at > NOW()
                 ORDER BY created_at DESC LIMIT 1`,
                [userId, code]
            );

            if (otpRows.length === 0) {
                return reply.status(401).send({ success: false, error: 'Código OTP inválido o expirado' });
            }

            // Marcar OTP como usado
            await pool.execute(
                'UPDATE otp_codes SET used = TRUE WHERE id = ?',
                [otpRows[0].id]
            );

            // Obtener datos del usuario
            const [userRows] = await pool.execute(
                'SELECT id, username, email, role FROM users WHERE id = ?',
                [userId]
            );

            if (userRows.length === 0) {
                return reply.status(404).send({ success: false, error: 'Usuario no encontrado' });
            }

            const user = userRows[0];
            const token = fastify.jwt.sign(
                { id: user.id, username: user.username, email: user.email, role: user.role },
                { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
            );

            reply.send({
                success: true,
                message: 'Autenticación exitosa',
                token,
                user: { id: user.id, username: user.username, email: user.email, role: user.role }
            });
        } catch (error) {
            reply.status(500).send({ success: false, error: 'Error del servidor', message: error.message });
        }
    });

    // =========================================================================
    // GET /auth/me - Obtener perfil del usuario autenticado
    // =========================================================================
    fastify.get('/me', {
        onRequest: [fastify.authenticate],
        schema: {
            description: 'Obtener el perfil del usuario autenticado',
            tags: ['Auth'],
            security: [{ bearerAuth: [] }],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        user: {
                            type: 'object',
                            properties: {
                                id: { type: 'number' },
                                username: { type: 'string' },
                                email: { type: 'string' },
                                role: { type: 'string' }
                            }
                        }
                    }
                }
            }
        }
    }, async (request, reply) => {
        try {
            const [rows] = await pool.execute(
                'SELECT id, username, email, role, created_at FROM users WHERE id = ?',
                [request.user.id]
            );
            if (rows.length === 0) {
                return reply.status(404).send({ success: false, error: 'Usuario no encontrado' });
            }
            reply.send({ success: true, user: rows[0] });
        } catch (error) {
            reply.status(500).send({ success: false, error: error.message });
        }
    });
}

export default authRoutes;