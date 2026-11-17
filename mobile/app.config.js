// Extends app.json. Firebase's google-services.json is kept out of git: on Expo's build servers it comes
// from the GOOGLE_SERVICES_JSON file variable, and locally from the file if it is present.
const fs = require('fs');

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);
  return { ...config, android: { ...config.android, ...(file ? { googleServicesFile: file } : {}) } };
};
