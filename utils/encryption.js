const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For AES, this is 16 bytes
const TAG_LENGTH = 16; // GCM authentication tag length

let encryptionKey = null;

/**
 * Loads the encryption key from environment variables.
 * Throws an error if the key is not found or is invalid.
 */
function loadEncryptionKey() {
    if (encryptionKey) {
        return encryptionKey;
    }

    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error('Encryption key (ENCRYPTION_KEY) not found in environment variables.');
    }

    try {
        const keyBuffer = Buffer.from(keyHex, 'hex');
        if (keyBuffer.length !== 32) { // AES-256 requires a 32-byte (256-bit) key
            throw new Error('Encryption key must be 32 bytes (256 bits) long when decoded from hex.');
        }
        encryptionKey = keyBuffer;
        return encryptionKey;
    } catch (error) {
        throw new Error(`Failed to load or parse encryption key: ${error.message}`);
    }
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * The output is a base64 string combining IV, encrypted data, and authentication tag.
 * @param {string} plaintext The string to encrypt.
 * @returns {string} The base64 encoded encrypted string.
 */
function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === '') {
        return plaintext; // Do not encrypt empty or null values
    }

    const key = loadEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // Combine IV, encrypted data, and authentication tag, then base64 encode
    return Buffer.from(iv.toString('hex') + encrypted + tag.toString('hex')).toString('base64');
}

/**
 * Decrypts an encrypted base64 string using AES-256-GCM.
 * @param {string} encryptedText The base64 encoded encrypted string.
 * @returns {string} The decrypted plaintext string.
 */
function decrypt(encryptedText) {
    if (encryptedText === null || encryptedText === undefined || encryptedText === '') {
        return encryptedText; // No need to decrypt empty or null values
    }

    const key = loadEncryptionKey();

    try {
        const decoded = Buffer.from(encryptedText, 'base64').toString('hex');

        const ivHex = decoded.substring(0, IV_LENGTH * 2);
        const encryptedHex = decoded.substring(IV_LENGTH * 2, decoded.length - TAG_LENGTH * 2);
        const tagHex = decoded.substring(decoded.length - TAG_LENGTH * 2);

        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        // Log the error but return original text or throw depending on desired behavior.
        // For now, let's re-throw to indicate a decryption failure.
        throw new Error(`Decryption failed: ${error.message}`);
    }
}

module.exports = {
    encrypt,
    decrypt,
    loadEncryptionKey // Export for initial key check in main app if needed
};
