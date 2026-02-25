-- =============================================================================
-- PE-3.1: Schema de Base de Datos con RLS y Auditoría
-- Base de Datos: MySQL 8.0+
-- =============================================================================

-- Crear base de datos
CREATE DATABASE IF NOT EXISTS pe31_rls;
USE pe31_rls;

-- =============================================================================
-- TABLA: users
-- Almacena los usuarios del sistema con autenticación y soporte OTP
-- =============================================================================
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS financial_records;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =============================================================================
-- TABLA: otp_codes
-- Almacena los códigos OTP temporales para autenticación por email
-- =============================================================================
CREATE TABLE IF NOT EXISTS otp_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =============================================================================
-- TABLA: financial_records (SENSIBLE - Requiere RLS)
-- Registros financieros que solo deben ser accesibles por su propietario
-- =============================================================================
CREATE TABLE IF NOT EXISTS financial_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    category ENUM('income', 'expense') DEFAULT 'expense',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =============================================================================
-- VISTA: financial_records_secure (Simula RLS a nivel de BD)
-- Usa una función para obtener el user_id de la sesión actual
-- =============================================================================

DELIMITER //

CREATE FUNCTION IF NOT EXISTS fn_current_user_id()
RETURNS INT
READS SQL DATA
DETERMINISTIC
BEGIN
    RETURN @app_current_user_id;
END //

DELIMITER ;

CREATE OR REPLACE VIEW financial_records_secure AS
SELECT * FROM financial_records
WHERE user_id = fn_current_user_id();

-- =============================================================================
-- TABLA: audit_logs
-- Registro inmutable de todas las operaciones de modificación
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
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
);

-- =============================================================================
-- TRIGGERS DE AUDITORÍA
-- Capturan automáticamente todas las operaciones DML en financial_records
-- =============================================================================

DELIMITER //

-- Trigger: INSERT
CREATE TRIGGER trg_financial_after_insert
AFTER INSERT ON financial_records
FOR EACH ROW
BEGIN
    INSERT INTO audit_logs (table_name, record_id, operation, new_data, db_user, app_user_id)
    VALUES (
        'financial_records', 
        NEW.id, 
        'INSERT', 
        JSON_OBJECT(
            'user_id', NEW.user_id, 
            'description', NEW.description, 
            'amount', NEW.amount,
            'category', NEW.category
        ),
        USER(),
        NEW.user_id
    );
END //

-- Trigger: UPDATE
CREATE TRIGGER trg_financial_after_update
AFTER UPDATE ON financial_records
FOR EACH ROW
BEGIN
    INSERT INTO audit_logs (table_name, record_id, operation, old_data, new_data, db_user, app_user_id)
    VALUES (
        'financial_records', 
        NEW.id, 
        'UPDATE',
        JSON_OBJECT(
            'user_id', OLD.user_id, 
            'description', OLD.description, 
            'amount', OLD.amount,
            'category', OLD.category
        ),
        JSON_OBJECT(
            'user_id', NEW.user_id, 
            'description', NEW.description, 
            'amount', NEW.amount,
            'category', NEW.category
        ),
        USER(),
        NEW.user_id
    );
END //

-- Trigger: DELETE
CREATE TRIGGER trg_financial_after_delete
AFTER DELETE ON financial_records
FOR EACH ROW
BEGIN
    INSERT INTO audit_logs (table_name, record_id, operation, old_data, db_user, app_user_id)
    VALUES (
        'financial_records', 
        OLD.id, 
        'DELETE',
        JSON_OBJECT(
            'user_id', OLD.user_id, 
            'description', OLD.description, 
            'amount', OLD.amount,
            'category', OLD.category
        ),
        USER(),
        OLD.user_id
    );
END //

DELIMITER ;

-- =============================================================================
-- USUARIO MCP (para el servidor MCP con permisos limitados)
-- =============================================================================
-- CREATE USER IF NOT EXISTS 'mcp_agent'@'localhost' IDENTIFIED BY 'Agent_Secret_Pass_123!';
-- GRANT SELECT ON pe31_rls.financial_records_secure TO 'mcp_agent'@'localhost';
-- GRANT SELECT ON pe31_rls.users TO 'mcp_agent'@'localhost';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON pe31_rls.financial_records TO 'mcp_agent'@'localhost';
-- GRANT SELECT ON pe31_rls.audit_logs TO 'mcp_agent'@'localhost';
-- GRANT SELECT, INSERT, UPDATE ON pe31_rls.otp_codes TO 'mcp_agent'@'localhost';
-- FLUSH PRIVILEGES;
