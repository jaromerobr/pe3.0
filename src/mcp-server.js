import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

// Configuración de la base de datos MCP
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: 'mcp_agent',
    password: 'Agent_Secret_Pass_123!',
    database: process.env.DB_NAME || 'pe31_rls'
};

const server = new Server({
    name: "MCP Server",
    version: "1.0.0",
    description: "MCP Server",
},
    { capabilities: { tools: {} } })

// Definir lo que la IA puede hacer (funcionalidades)
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return {
        tools: [
            {
                name: "db_readonly",
                description: "Consulta segura de información financiera. SOlo permite leer balance y sus transacciones",
                inputSchema: {
                    type: "object",
                    properties: {
                        query_type: {
                            type: "string",
                            enum: ["balance", "get_last_transactions"],
                            description: "Tipo de consulta: 'balance' o 'get_last_transactions'"
                        },
                        account_id: {
                            type: "integer",
                            description: "ID de la cuenta para la cual se realiza la consulta"
                        }
                    },
                    required: ["query_type", "account_id"]
                }
            }
        ]
    }
})


//Ejecutar las herramientas
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'db_readonly') throw new Error("Tool not found");

    // Validación Estricta - Crear la regla de validación
    const inputSchema = z.object({
        query_type: z.enum(["balance", "get_last_transactions"]),
        account_id: z.number().int().positive()
    })

    try {
        // Validación Estricta - Validar la entrada
        const { query_type, account_id } = inputSchema.parse(request.params.arguments);

        const connection = await mysql.createConnection(DB_CONFIG);

        try {
            //Establecer identididad
            //Antes de cualquier consulta le decimos a la BD "Quienes somos"
            await connection.execute(
                "SET @app_current_user_id = ?",
                [account_id]
            );

            let result;
            if (query_type === "balance") {
                const [row] = await connection.execute(
                    "SELECT SUM(amount) as total_balance FROM financial_records_secure"
                );
                result = row[0].total_balance || 0;
            } else if (query_type === "get_last_transactions") {
                const [rows] = await connection.execute(
                    "SELECT * FROM financial_records_secure ORDER BY created_at DESC LIMIT 5"
                );
                result = rows;
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }
                ]
            }
        } finally {
            connection.end();
        }
    } catch (error) {
        return {
            content: [{
                type: "text",
                text: "Error al ejecutar la herramienta: " + error.message,
                isError: true
            }
            ]
        }
    }
})

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server started");
}

main().catch(console.error);