const mineflayer = require('mineflayer') // eslint-disable-line
const functions = require("../functions");
/** @param {mineflayer.Bot} bot */

var recent_chat_limit = 3
var recent_chats = {}
module.exports = bot => {
    var username = 'Vrinimi'
    var regex_hi = new RegExp("<(.+)>(.*?(?:hello| hi | hey|wassup|hew+o).*?"+'vrin'+".*)", "i")
    var regex_simple_hi = new RegExp('^(?:hello|hi|hey) '+username+'$', "i")
    //var regex_replace = new RegExp(username, "i")
    bot.addChatPattern('hi_pattern', regex_hi, { parse: true })
    bot.on('chat:hi_pattern', (match) => {
        var chat_data = String(match).split(',')
        var playerIgn = chat_data[0], chat = chat_data[1]
        if(playerIgn in recent_chats){
            if(recent_chats[playerIgn] > recent_chat_limit) return
            ++recent_chats[playerIgn]
        }
        else recent_chats[playerIgn] = 1
        setTimeout(() => {--recent_chats[playerIgn]}, 1000*30)  // 30s
        if(functions.isNearby(bot, playerIgn)){
            //bot.chat(chat.replace(regex_replace, playerIgn))
            if(chat.match(regex_simple_hi)){
                bot.chat(`hi ${playerIgn}`)
                return
            }
            bot.chat(`hi ${playerIgn}, i'm Vrinimi`)
        }
    })
}