const path = require('path');
const fs = require('fs');

// Load .env from project root if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

function parseBool(value, defaultValue = false) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function getEnvString(key, defaultValue = '') {
  const value = process.env[key];
  if (value == null) return defaultValue;
  return String(value);
}

function resolveDatabasePassword() {
  const passwordFileRaw = process.env.DATABASE_PASSWORD_FILE;
  const passwordFile = typeof passwordFileRaw === 'string' ? passwordFileRaw.trim() : '';
  if (passwordFile) {
    const filePath = path.isAbsolute(passwordFile)
      ? passwordFile
      : path.join(__dirname, '..', passwordFile);
    try {
      const fileContents = fs.readFileSync(filePath, 'utf8');
      return fileContents.trim();
    } catch (error) {
      console.warn(`Unable to read DATABASE_PASSWORD_FILE at ${filePath}: ${error.message}`);
    }
  }
  return getEnvString('DATABASE_PASSWORD');
}

const config = {
  recaptchaSiteKey: getEnvString('RECAPTCHA_SITE_KEY'),
  recaptchaSecret: getEnvString('RECAPTCHA_SECRET'),
  mailer: {
    host: getEnvString('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT || 587),
    secure: parseBool(process.env.SMTP_SECURE, false),
    user: getEnvString('SMTP_USER'),
    pass: getEnvString('SMTP_PASS'),
    fromName: getEnvString('EMAIL_FROM_NAME', 'Auction Web'),
    fromAddress: getEnvString('EMAIL_FROM_ADDRESS'),
  },
  database: {
    host: getEnvString('DATABASE_HOST', 'localhost'),
    port: Number(process.env.DATABASE_PORT || 5432),
    database: getEnvString('DATABASE_NAME', 'postgres'),
    user: getEnvString('DATABASE_USER', 'postgres'),
    password: resolveDatabasePassword(),
    ssl: parseBool(process.env.DATABASE_SSL, true)
      ? {
          rejectUnauthorized: false,
        }
      : false,
  },
};


if (typeof config.database.password !== 'string') {
  config.database.password = String(config.database.password || '');
}

if (!config.mailer.fromAddress && config.mailer.user) {
  config.mailer.fromAddress = config.mailer.user;
}

['host', 'user', 'pass', 'fromAddress'].forEach((key) => {
  if (config.mailer[key] == null) {
    config.mailer[key] = '';
  }
});

module.exports = config;
