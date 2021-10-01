const functions = require("../functions");
const fs = require('fs')

var just_joined = true
var recent_wbs = 0
var reported_users = {}
var recent_chats = 0
var recent_invis_warning = false
var chat_file_reader_interval = undefined
var updating_votes = false
var updated_voters = {}
module.exports = bot => {
    bot.on('spawn', () => {
        setTimeout(() => bot.chat('/sit'), 1000) // 20 ticks
        setTimeout(() => just_joined=false, 1000*20) // 20s
    })

    // chat interaction
    bot.on('chat', (who, msg) => {
        if(just_joined && msg === 'wb' || /wb v/i.test(msg)){
            ++recent_wbs
            if(recent_wbs === 1) setTimeout(() => {
                if(recent_wbs === 1) bot.chat('ty')
                else bot.chat('ty x'+recent_wbs)
                recent_wbs = 0
            }, 2500)  // 2.5s
        }
        if(/nigger/i.test(msg) && !(who in reported_users)){
            bot.chat('/report '+who+' n-word in chat')
            reported_users[who] = true
        }
        if(/Vrin/i.test(msg) && msg.includes('bot') && msg.includes('?')){
            if(recent_chats < 3){
                bot.chat('☉_☉')
                ++recent_chats
                setTimeout(() => --recent_chats, 1000*60*5)  // 5 mins
            }
        }
    })

    // warn of nearby invis when people drop items
    bot.on('itemDrop', (item) => {
        let num_invis = functions.numNearbyInvisPlayers(bot, dist=15)
        if(num_invis > 0 && !recent_invis_warning){
            recent_invis_warning = true
            //if(num_invis > 1) bot.chat('Look out, invis players are here')
            //else 
            bot.chat('Look out, an invis player is here')
            setTimeout(() => recent_invis_warning=false, 5*60*1000)  // 5m
        }
    })

    //listen for scoreboard updates
    bot.on('scoreUpdated', (scoreboard, updated) => {
        //console.log(`Scoreboard score: ${scoreboard.title}, ${updated.name}, ${updated.value}`)
        if(scoreboard.title === 'vote' && Number(updated.value) != 0){
            updated_voters[updated.name.toLowerCase()] = Number(updated.value)
            if(!updating_votes){
                updating_votes = true
                setTimeout(() => {
                    let data = fs.readFileSync('player_votes.txt', 'utf8')
                    for(var name in updated_voters){
                        const votes = updated_voters[name]
                        const c_name_c = ','+name+','
                        if(data.includes(c_name_c)){
                            if(data.includes(c_name_c+votes+',')) continue
                            //if(!data.includes(c_name_c+(votes-1)+',')){
                            //    console.log('WARNING: adding multiple votes for '+name)
                            //}
                            data = data.replace(new RegExp(c_name_c+'\\d+,'), c_name_c+votes+',')
                        }
                        else{
                            var uuid = 'unknown:'+name
                            if(name in bot.players) uuid = bot.players[name].uuid
                            console.log('Adding new voter: '+name)
                            data += '\n'+uuid+c_name_c+votes+',0'
                        }
                    }
                    fs.writeFileSync('player_votes.txt', data, (err)=>{if(err)console.log(err)});
                    updating_votes = false
                }, 5000)  // batch votes every 5s
            }
        }
        else if(scoreboard.title !== 'vote'){
            console.log(`Scoreboard score: ${scoreboard.title}, ${updated.name}, ${updated.value}`)
            console.log(JSON.stringify(scoreboard))
        }
    })
}