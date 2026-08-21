import dotenv from 'dotenv';
import { prisma } from '@seabridge/database';
import app from './app';

dotenv.config();

// ---------------------------------------------------------------------------
// Environment validation — fail early so a misconfigured container never
// starts in a state that silently compromises authentication.
// ---------------------------------------------------------------------------
(function validateEnv() {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error(
      '❌ FATAL: JWT_SECRET environment variable is not set.\n' +
      '   Anyone could forge authentication tokens without it.\n' +
      '   Set JWT_SECRET to at least 32 random characters and restart.'
    );
    process.exit(1);
  }

  if (jwtSecret.length < 32) {
    console.error(
      '❌ FATAL: JWT_SECRET is too short (minimum 32 characters).\n' +
      '   A short secret can be brute-forced. Generate a strong one:\n' +
      '     PowerShell: -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})\n' +
      '     bash:       openssl rand -base64 36'
    );
    process.exit(1);
  }
})();

const PORT = process.env.PORT || 4000;

// Start server
const startServer = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
    
    app.listen(PORT, () => {
      console.log(`🚀 SeaBridge API running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
