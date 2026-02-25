import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

// ============================================================================
// Configuración de Base de Datos
// ============================================================================
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'pe31_rls'
};

// ============================================================================
// Configuración de Email (para OTP)
// ============================================================================
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASSWORD
    }
});

// Estado de sesión del MCP (almacena el usuario autenticado)
let authenticatedUser = null;

// Genera OTP de 6 dígitos
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================================
// Servidor MCP
// ============================================================================
const server = new Server({
    name: "PE-3.1 MCP Server - Gestión Financiera",
    version: "1.0.0",
    description: "Servidor MCP con autenticación OTP, RLS y CRUD financiero",
}, { capabilities: { tools: {} } });

// ============================================================================
// LISTA DE HERRAMIENTAS (lo que la IA puede hacer)
// ============================================================================
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            // --- AUTENTICACIÓN ---
            {
                name: "auth_login",
                description: "Paso 1 de autenticación: Ingresa usuario y contraseña. Si son válidos, se envía un código OTP al correo electrónico del usuario.",
                inputSchema: {
                    type: "object",
                    properties: {
                        username: { type: "string", description: "Nombre de usuario" },
                        password: { type: "string", description: "Contraseña del usuario" }
                    },
                    required: ["username", "password"]
                }
            },
            {
                name: "auth_verify_otp",
                description: "Paso 2 de autenticación: Verifica el código OTP enviado al correo. Si es válido, el usuario queda autenticado en la sesión MCP.",
                inputSchema: {
                    type: "object",
                    properties: {
                        user_id: { type: "integer", description: "ID del usuario (proporcionado en auth_login)" },
                        otp_code: { type: "string", description: "Código OTP de 6 dígitos recibido por email" }
                    },
                    required: ["user_id", "otp_code"]
                }
            },
            {
                name: "auth_status",
                description: "Verifica el estado actual de autenticación. Muestra si hay un usuario autenticado y sus datos.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "auth_logout",
                description: "Cierra la sesión del usuario autenticado en el MCP.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            // --- REGISTROS FINANCIEROS (CRUD con RLS) ---
            {
                name: "records_list",
                description: "Obtener los registros financieros del usuario autenticado. Aplica RLS: usuarios normales solo ven sus registros, admins ven todos.",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Cantidad máxima de registros (default: 20)", default: 20 }
                    }
                }
            },
            {
                name: "records_get_balance",
                description: "Obtener el balance financiero (suma de ingresos y egresos) del usuario autenticado. Aplica RLS.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "records_create",
                description: "Crear un nuevo registro financiero para el usuario autenticado.",
                inputSchema: {
                    type: "object",
                    properties: {
                        description: { type: "string", description: "Descripción del registro financiero" },
                        amount: { type: "number", description: "Monto (positivo para ingresos, cualquier valor para egresos)" },
                        category: { type: "string", enum: ["income", "expense"], description: "Categoría: 'income' o 'expense'" }
                    },
                    required: ["description", "amount", "category"]
                }
            },
            {
                name: "records_update",
                description: "Actualizar un registro financiero existente. Solo el propietario o un admin pueden hacerlo (RLS).",
                inputSchema: {
                    type: "object",
                    properties: {
                        record_id: { type: "integer", description: "ID del registro a actualizar" },
                        description: { type: "string", description: "Nueva descripción" },
                        amount: { type: "number", description: "Nuevo monto" },
                        category: { type: "string", enum: ["income", "expense"], description: "Nueva categoría" }
                    },
                    required: ["record_id"]
                }
            },
            {
                name: "records_delete",
                description: "Eliminar un registro financiero. Solo el propietario o un admin pueden hacerlo (RLS).",
                inputSchema: {
                    type: "object",
                    properties: {
                        record_id: { type: "integer", description: "ID del registro a eliminar" }
                    },
                    required: ["record_id"]
                }
            },
            // --- AUDITORÍA ---
            {
                name: "audit_list",
                description: "Obtener los registros de auditoría del sistema. Muestra las operaciones realizadas sobre los registros financieros.",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Cantidad máxima de registros (default: 10)", default: 10 }
                    }
                }
            }
        ]
    };
});

// ============================================================================
// EJECUTAR HERRAMIENTAS
// ============================================================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    let connection;

    try {
        connection = await mysql.createConnection(DB_CONFIG);

        switch (name) {

            // ==================================================================
            // AUTH: LOGIN (Paso 1 - Enviar OTP)
            // ==================================================================
            case "auth_login": {
                const schema = z.object({
                    username: z.string(),
                    password: z.string()
                });
                const { username, password } = schema.parse(args);

                // Buscar usuario
                const [users] = await connection.execute(
                    "SELECT * FROM users WHERE username = ?",
                    [username]
                );

                if (users.length === 0) {
                    return textResponse("❌ Credenciales inválidas. Usuario no encontrado.");
                }

                const user = users[0];
                const isValid = await bcrypt.compare(password, user.password_hash);
                if (!isValid) {
                    return textResponse("❌ Credenciales inválidas. Contraseña incorrecta.");
                }

                // Generar y guardar OTP
                const otpCode = generateOTP();
                const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

                await connection.execute(
                    "UPDATE otp_codes SET used = TRUE WHERE user_id = ? AND used = FALSE",
                    [user.id]
                );
                await connection.execute(
                    "INSERT INTO otp_codes (user_id, code, expires_at) VALUES (?, ?, ?)",
                    [user.id, otpCode, expiresAt]
                );

                // Enviar OTP por email
                try {
                    await transporter.sendMail({
                        from: process.env.GMAIL_USER,
                        to: user.email,
                        subject: "Código OTP - PE 3.1 MCP",
                        text: `Tu código de verificación es: ${otpCode}\nExpira en 5 minutos.`,
                        html: `<h2>Código de Verificación</h2><p>Tu código OTP es: <strong>${otpCode}</strong></p><p>Expira en 5 minutos.</p>`
                    });
                } catch (emailErr) {
                    return textResponse(`⚠️ Credenciales válidas pero error enviando email: ${emailErr.message}`);
                }

                const emailParts = user.email.split('@');
                const emailHint = emailParts[0].substring(0, 3) + '***@' + emailParts[1];

                return textResponse(
                    `✅ Credenciales válidas.\n` +
                    `📧 Se ha enviado un código OTP al correo: ${emailHint}\n` +
                    `🔑 User ID: ${user.id}\n\n` +
                    `Usa la herramienta 'auth_verify_otp' con el user_id ${user.id} y el código recibido por email.`
                );
            }

            // ==================================================================
            // AUTH: VERIFY OTP (Paso 2 - Verificar y autenticar)
            // ==================================================================
            case "auth_verify_otp": {
                const schema = z.object({
                    user_id: z.number().int().positive(),
                    otp_code: z.string().length(6)
                });
                const { user_id, otp_code } = schema.parse(args);

                const [otpRows] = await connection.execute(
                    `SELECT * FROM otp_codes 
                     WHERE user_id = ? AND code = ? AND used = FALSE AND expires_at > NOW()
                     ORDER BY created_at DESC LIMIT 1`,
                    [user_id, otp_code]
                );

                if (otpRows.length === 0) {
                    return textResponse("❌ Código OTP inválido o expirado. Intenta iniciar sesión de nuevo.");
                }

                // Marcar OTP como usado
                await connection.execute(
                    "UPDATE otp_codes SET used = TRUE WHERE id = ?",
                    [otpRows[0].id]
                );

                // Obtener datos del usuario
                const [userRows] = await connection.execute(
                    "SELECT id, username, email, role FROM users WHERE id = ?",
                    [user_id]
                );

                if (userRows.length === 0) {
                    return textResponse("❌ Usuario no encontrado.");
                }

                // Guardar sesión autenticada
                authenticatedUser = userRows[0];

                return textResponse(
                    `✅ ¡Autenticación exitosa!\n\n` +
                    `👤 Usuario: ${authenticatedUser.username}\n` +
                    `📧 Email: ${authenticatedUser.email}\n` +
                    `🔒 Rol: ${authenticatedUser.role}\n` +
                    `🆔 ID: ${authenticatedUser.id}\n\n` +
                    `Ya puedes usar las herramientas de registros financieros. Tus datos están protegidos por RLS.`
                );
            }

            // ==================================================================
            // AUTH: STATUS
            // ==================================================================
            case "auth_status": {
                if (!authenticatedUser) {
                    return textResponse("🔒 No hay sesión activa. Usa 'auth_login' para iniciar sesión.");
                }
                return textResponse(
                    `✅ Sesión activa:\n` +
                    `👤 Usuario: ${authenticatedUser.username}\n` +
                    `📧 Email: ${authenticatedUser.email}\n` +
                    `🔒 Rol: ${authenticatedUser.role}\n` +
                    `🆔 ID: ${authenticatedUser.id}`
                );
            }

            // ==================================================================
            // AUTH: LOGOUT
            // ==================================================================
            case "auth_logout": {
                if (!authenticatedUser) {
                    return textResponse("ℹ️ No hay sesión activa.");
                }
                const username = authenticatedUser.username;
                authenticatedUser = null;
                return textResponse(`✅ Sesión de '${username}' cerrada correctamente.`);
            }

            // ==================================================================
            // RECORDS: LIST (con RLS)
            // ==================================================================
            case "records_list": {
                requireAuth();
                const limit = args?.limit || 20;

                // Establecer identidad RLS
                await connection.execute("SET @app_current_user_id = ?", [authenticatedUser.id]);

                let query, params;
                if (authenticatedUser.role === 'admin') {
                    query = "SELECT * FROM financial_records ORDER BY created_at DESC LIMIT ?";
                    params = [String(limit)];
                } else {
                    query = "SELECT * FROM financial_records_secure ORDER BY created_at DESC LIMIT ?";
                    params = [String(limit)];
                }

                const [records] = await connection.execute(query, params);

                return textResponse(
                    `📊 Registros financieros (${records.length} encontrados):\n` +
                    `🔒 RLS: ${authenticatedUser.role === 'admin' ? 'Admin - Sin restricciones' : `Solo registros del usuario ${authenticatedUser.id}`}\n\n` +
                    JSON.stringify(records, null, 2)
                );
            }

            // ==================================================================
            // RECORDS: BALANCE (con RLS)
            // ==================================================================
            case "records_get_balance": {
                requireAuth();
                await connection.execute("SET @app_current_user_id = ?", [authenticatedUser.id]);

                let query;
                if (authenticatedUser.role === 'admin') {
                    query = `SELECT 
                        COALESCE(SUM(CASE WHEN category = 'income' THEN amount ELSE 0 END), 0) as total_income,
                        COALESCE(SUM(CASE WHEN category = 'expense' THEN amount ELSE 0 END), 0) as total_expense,
                        COALESCE(SUM(CASE WHEN category = 'income' THEN amount ELSE -amount END), 0) as balance
                    FROM financial_records`;
                } else {
                    query = `SELECT 
                        COALESCE(SUM(CASE WHEN category = 'income' THEN amount ELSE 0 END), 0) as total_income,
                        COALESCE(SUM(CASE WHEN category = 'expense' THEN amount ELSE 0 END), 0) as total_expense,
                        COALESCE(SUM(CASE WHEN category = 'income' THEN amount ELSE -amount END), 0) as balance
                    FROM financial_records_secure`;
                }

                const [rows] = await connection.execute(query);
                const data = rows[0];

                return textResponse(
                    `💰 Balance Financiero de ${authenticatedUser.username}:\n\n` +
                    `📈 Total Ingresos: $${data.total_income}\n` +
                    `📉 Total Egresos: $${data.total_expense}\n` +
                    `💵 Balance Neto: $${data.balance}\n\n` +
                    `🔒 RLS aplicado: ${authenticatedUser.role === 'admin' ? 'Todos los registros' : `Solo usuario ${authenticatedUser.id}`}`
                );
            }

            // ==================================================================
            // RECORDS: CREATE
            // ==================================================================
            case "records_create": {
                requireAuth();
                const schema = z.object({
                    description: z.string().min(1),
                    amount: z.number().positive(),
                    category: z.enum(["income", "expense"])
                });
                const { description, amount, category } = schema.parse(args);

                const [result] = await connection.execute(
                    "INSERT INTO financial_records (user_id, description, amount, category) VALUES (?, ?, ?, ?)",
                    [authenticatedUser.id, description, amount, category]
                );

                return textResponse(
                    `✅ Registro financiero creado exitosamente:\n\n` +
                    `🆔 ID: ${result.insertId}\n` +
                    `📝 Descripción: ${description}\n` +
                    `💵 Monto: $${amount}\n` +
                    `📂 Categoría: ${category}\n` +
                    `👤 Usuario: ${authenticatedUser.username} (ID: ${authenticatedUser.id})`
                );
            }

            // ==================================================================
            // RECORDS: UPDATE (con RLS)
            // ==================================================================
            case "records_update": {
                requireAuth();
                const schema = z.object({
                    record_id: z.number().int().positive(),
                    description: z.string().optional(),
                    amount: z.number().optional(),
                    category: z.enum(["income", "expense"]).optional()
                });
                const { record_id, description, amount, category } = schema.parse(args);

                // Verificar propiedad (RLS)
                const [existing] = await connection.execute(
                    "SELECT * FROM financial_records WHERE id = ?",
                    [record_id]
                );

                if (existing.length === 0) {
                    return textResponse("❌ Registro no encontrado.");
                }

                if (authenticatedUser.role !== 'admin' && existing[0].user_id !== authenticatedUser.id) {
                    return textResponse("🔒 Acceso denegado. RLS: Solo puedes modificar tus propios registros.");
                }

                // Construir actualización dinámica
                const updates = [];
                const values = [];
                if (description !== undefined) { updates.push("description = ?"); values.push(description); }
                if (amount !== undefined) { updates.push("amount = ?"); values.push(amount); }
                if (category !== undefined) { updates.push("category = ?"); values.push(category); }

                if (updates.length === 0) {
                    return textResponse("⚠️ No se proporcionaron campos para actualizar.");
                }

                values.push(record_id);
                await connection.execute(
                    `UPDATE financial_records SET ${updates.join(", ")} WHERE id = ?`,
                    values
                );

                return textResponse(
                    `✅ Registro #${record_id} actualizado correctamente.\n` +
                    `${description ? `📝 Descripción: ${description}\n` : ''}` +
                    `${amount ? `💵 Monto: $${amount}\n` : ''}` +
                    `${category ? `📂 Categoría: ${category}\n` : ''}`
                );
            }

            // ==================================================================
            // RECORDS: DELETE (con RLS)
            // ==================================================================
            case "records_delete": {
                requireAuth();
                const schema = z.object({
                    record_id: z.number().int().positive()
                });
                const { record_id } = schema.parse(args);

                // Verificar propiedad (RLS)
                const [existing] = await connection.execute(
                    "SELECT * FROM financial_records WHERE id = ?",
                    [record_id]
                );

                if (existing.length === 0) {
                    return textResponse("❌ Registro no encontrado.");
                }

                if (authenticatedUser.role !== 'admin' && existing[0].user_id !== authenticatedUser.id) {
                    return textResponse("🔒 Acceso denegado. RLS: Solo puedes eliminar tus propios registros.");
                }

                await connection.execute(
                    "DELETE FROM financial_records WHERE id = ?",
                    [record_id]
                );

                return textResponse(`✅ Registro #${record_id} eliminado correctamente.`);
            }

            // ==================================================================
            // AUDIT: LIST
            // ==================================================================
            case "audit_list": {
                requireAuth();
                const limit = args?.limit || 10;

                const [records] = await connection.execute(
                    "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?",
                    [String(limit)]
                );

                return textResponse(
                    `📋 Registros de Auditoría (${records.length} encontrados):\n\n` +
                    JSON.stringify(records, null, 2)
                );
            }

            default:
                throw new Error(`Herramienta '${name}' no encontrada.`);
        }
    } catch (error) {
        return {
            content: [{
                type: "text",
                text: `❌ Error: ${error.message}`
            }],
            isError: true
        };
    } finally {
        if (connection) await connection.end();
    }
});

// ============================================================================
// HELPERS
// ============================================================================
function requireAuth() {
    if (!authenticatedUser) {
        throw new Error("🔒 No autenticado. Debes iniciar sesión primero con 'auth_login' y luego verificar el OTP con 'auth_verify_otp'.");
    }
}

function textResponse(text) {
    return {
        content: [{ type: "text", text }]
    };
}

// ============================================================================
// INICIO DEL SERVIDOR MCP
// ============================================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ MCP Server started - PE 3.1 Gestión Financiera");
}

main().catch(console.error);