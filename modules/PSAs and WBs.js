const mineflayer = require('mineflayer') // eslint-disable-line
const functions = require("../functions");
/** @param {mineflayer.Bot} bot */

var thunder = false
var just_joined = true
var working_hrs = true

function psaThunderstorm(bot){
    const weather_subscribers_set = functions.getWeatherSubscribers()
    for(var name in bot.players){
        if(weather_subscribers_set.has(name.toLowerCase())){
            bot.chat('/msg '+name+' thunderstorm!')
        }
    }
}

// thunder PSA
var recent_thunder_start = false
function checkWeather(bot){
    if(thunder && bot.thunderState < 0.01) thunder = false
    else if(!thunder && bot.thunderState > 0.01 && (bot.isRaining || bot.rainState > 0.01) && !recent_thunder_start){
        thunder = true
        recent_thunder_start = true
        setTimeout(()=>recent_thunder_start=false, 2*60*1000)  // 2m
        //bot.chat('PSA: Thunderstorm!')
        psaThunderstorm(bot)
    }
}

function psaVillagers(bot, is_work){
    const villager_subscribers_set = functions.getVillagerSubscribers()
    for(var name in bot.players){
        if(villager_subscribers_set.has(name.toLowerCase())){
            bot.chat('/msg '+name+' villager restock '+(is_work ? 'begin' : 'end'))
        }
    }
}

// villager PSA
function checkTime(bot){
    var upd_working_hrs = (bot.time.timeOfDay >= 2000 && bot.time.timeOfDay < 9000)
    if(upd_working_hrs != working_hrs){
        working_hrs = upd_working_hrs
        psaVillagers(bot, working_hrs)
    }
}


module.exports = bot => {
    bot.on('spawn', () => {
        setTimeout(() => just_joined=false, 1000*15) // 15s
        working_hrs = bot.time.timeOfDay >= 2000 && bot.time.timeOfDay < 9000
        setInterval(() => {
            checkWeather(bot)
            checkTime(bot)
        }, 2000) // every 2s
    })
    bot.on('playerJoined', (p)=>{
        // wb jojo
        if(!just_joined && p.username === 'JoJoShabbadoo') setTimeout(() => bot.chat('wb'), 1500) // in 1.5s
        // update name & uuid of offline voters
        setTimeout(() => {if(p) functions.getVotes(p.username, p.uuid, bot)})
    })
}