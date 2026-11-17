// Extends app.json. Firebase's google-services.json is kept out of git: on Expo's build servers it comes
// from the GOOGLE_SERVICES_JSON file variable, and locally from the file if it is present.
const fs = require('fs');

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);
  // The public web demo is served from a sub-folder (GitHub Pages), set by EXPO_BASE_URL when exporting for web.
  const baseUrl = process.env.EXPO_BASE_URL;
  return {
    ...config,
    android: { ...config.android, ...(file ? { googleServicesFile: file } : {}) },
    ...(baseUrl ? { experiments: { ...config.experiments, baseUrl }, web: { ...config.web, output: 'single' } } : {}),
  };
};
