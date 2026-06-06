require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT) || 3000,
  ruleImport: {
    auditNoChange: process.env.RULE_IMPORT_AUDIT_NO_CHANGE === 'true'
  }
};

module.exports = config;
