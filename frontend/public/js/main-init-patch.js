const fs = require('fs');

let mainJs = fs.readFileSync('frontend/js/main.js', 'utf8');

// Ensure loadFleets is called, and predefined agents are populated on init
const initHook = `
        // Initial setup for Fleet
        if (app.fleet && typeof app.fleet.selectPlan === 'function') {
            setTimeout(() => {
                app.fleet.selectPlan('starter');
            }, 500);
        }
`;

mainJs = mainJs.replace('// Setup Routing', initHook + '\n        // Setup Routing');

fs.writeFileSync('frontend/js/main.js', mainJs);
