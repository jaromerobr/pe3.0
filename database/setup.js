import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function setupDatabase() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'root',
            multipleStatements: true
        });

        console.log('Connected to MySQL');

        // Step 1: Create database
        await connection.query('CREATE DATABASE IF NOT EXISTS pe31_rls');
        await connection.query('USE pe31_rls');
        console.log('Database pe31_rls ready');

        // Step 2: Drop existing objects
        await connection.query('DROP VIEW IF EXISTS financial_records_secure');
        await connection.query('DROP TABLE IF EXISTS audit_logs');
        await connection.query('DROP TABLE IF EXISTS financial_records');
        await connection.query('DROP TABLE IF EXISTS otp_codes');
        await connection.query('DROP TABLE IF EXISTS users');
        await connection.query('DROP FUNCTION IF EXISTS fn_current_user_id');
        console.log('Cleaned up existing objects');

        // Step 3: Create tables
        await connection.query(`
            CREATE TABLE users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('admin', 'user') DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('  - Table users created');

        await connection.query(`
            CREATE TABLE otp_codes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                code VARCHAR(6) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        console.log('  - Table otp_codes created');

        await connection.query(`
            CREATE TABLE financial_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                description VARCHAR(255) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                category ENUM('income', 'expense') DEFAULT 'expense',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        console.log('  - Table financial_records created');

        await connection.query(`
            CREATE TABLE audit_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                table_name VARCHAR(50) NOT NULL,
                record_id INT NOT NULL,
                operation ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
                old_data JSON,
                new_data JSON,
                db_user VARCHAR(100),
                app_user_id INT,
                ip_address VARCHAR(45),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_table_name (table_name),
                INDEX idx_operation (operation),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('  - Table audit_logs created');

        // Step 4: Create function for RLS view
        await connection.query(`
            CREATE FUNCTION fn_current_user_id()
            RETURNS INT
            READS SQL DATA
            DETERMINISTIC
            RETURN @app_current_user_id
        `);
        console.log('  - Function fn_current_user_id created');

        // Step 5: Create RLS view
        await connection.query(`
            CREATE VIEW financial_records_secure AS
            SELECT * FROM financial_records
            WHERE user_id = fn_current_user_id()
        `);
        console.log('  - View financial_records_secure created');

        // Step 6: Create triggers
        await connection.query(`
            CREATE TRIGGER trg_financial_after_insert
            AFTER INSERT ON financial_records
            FOR EACH ROW
            INSERT INTO audit_logs (table_name, record_id, operation, new_data, db_user, app_user_id)
            VALUES (
                'financial_records', NEW.id, 'INSERT',
                JSON_OBJECT('user_id', NEW.user_id, 'description', NEW.description, 'amount', NEW.amount, 'category', NEW.category),
                USER(), NEW.user_id
            )
        `);
        console.log('  - Trigger INSERT created');

        await connection.query(`
            CREATE TRIGGER trg_financial_after_update
            AFTER UPDATE ON financial_records
            FOR EACH ROW
            INSERT INTO audit_logs (table_name, record_id, operation, old_data, new_data, db_user, app_user_id)
            VALUES (
                'financial_records', NEW.id, 'UPDATE',
                JSON_OBJECT('user_id', OLD.user_id, 'description', OLD.description, 'amount', OLD.amount, 'category', OLD.category),
                JSON_OBJECT('user_id', NEW.user_id, 'description', NEW.description, 'amount', NEW.amount, 'category', NEW.category),
                USER(), NEW.user_id
            )
        `);
        console.log('  - Trigger UPDATE created');

        await connection.query(`
            CREATE TRIGGER trg_financial_after_delete
            AFTER DELETE ON financial_records
            FOR EACH ROW
            INSERT INTO audit_logs (table_name, record_id, operation, old_data, db_user, app_user_id)
            VALUES (
                'financial_records', OLD.id, 'DELETE',
                JSON_OBJECT('user_id', OLD.user_id, 'description', OLD.description, 'amount', OLD.amount, 'category', OLD.category),
                USER(), OLD.user_id
            )
        `);
        console.log('  - Trigger DELETE created');

        // Verify
        const [tables] = await connection.query('SHOW TABLES FROM pe31_rls');
        console.log('\nAll tables/views:');
        tables.forEach(row => console.log(`  - ${Object.values(row)[0]}`));

        console.log('\n✅ Database setup complete!');
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.sql) console.error('SQL:', error.sql.substring(0, 200));
    } finally {
        if (connection) await connection.end();
    }
}

setupDatabase();
