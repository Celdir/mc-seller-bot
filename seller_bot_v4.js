// in console/cmdprompts: npm install nerdamer

const fs = require('fs')
const path = require('path')
const functions = require('./functions');

const OPTIONS = {
    host: '',
    username: '',
    password: '',
    auth: ''
}

function injectModules(bot){
    const MODULES_DIRECTORY = path.join(__dirname, 'modules')
    const modules = fs
        .readdirSync(MODULES_DIRECTORY) // find the plugins
        .filter(x => x.endsWith('.js')) // only use .js files
        .map(pluginName => require(path.join(MODULES_DIRECTORY, pluginName)))
    bot.loadPlugins(modules)
}

var bot = undefined
function makeSellerBot(){
    bot = functions.makeRejoiningBot(OPTIONS, injectModules, makeSellerBot)
}
makeSellerBot()
