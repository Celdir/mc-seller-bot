const mineflayer = require('mineflayer')
const fs = require('fs')
const functions = require('../functions');
const handle_message = require('../handle_message');
//delete require.cache[require.resolve('../handle_message.js')]
//handle_message = require('../handle_message.js')
/** @param {mineflayer.Bot} bot */

module.exports = bot => {

var item_fullname={}, item_sellname={}, item_price={}, item_stock={}, item_defamt={}
var item_fullname_to_name = {}
var services_set = new Set(['endtp', 'holdspot', 'netp', 'nwtp', 'setp', 'swtp', 'weather_psa'])
var weather_subscribers_set = new Set()
var min_item_name = 999
var cur_player = null
var cur_revenue = 1_000_000
var chats_since_last_ad = 0
var last_ad_epoch_mins = Date.now() / 1000 / 60
var last_item_ad = ''
var bad_counter = {}
var busy_doing_tp = false
var tp_services_being_sold = {/* map from who -> tpServiceCallback */}

const TPBOT_OPTIONS = {
    //host: 'old.altcraft.net',
    host: '',
    username: '',
    password: '',
    auth: ''
}

let tpbots = {}
let tpbot_ready = {}
let tpbot_loc = {}
let tpbot_bed_loc = {}
let tpbot_home_loc = {}
let tpbot_deaths = {}
let tpbot_hold_spot_player = {}
let tpbot_hold_spot_until_ts = {}
let tpbot_proposed_hold_spot_until_ts = {}
function isBotReady(bot_name){return bot_name in tpbot_ready && tpbot_ready[bot_name]}

function anyBotHasAccess(loc){
    for(const n in tpbot_loc) if(tpbot_loc[n] === loc) return true
    for(const n in tpbot_bed_loc) if(tpbot_bed_loc[n] === loc) return true
    for(const n in tpbot_home_loc) if(tpbot_home_loc[n] === loc) return true
    return false
}

function initTpBot(bot_name, OPTIONS, tp_who){
    if(!(bot_name in tpbot_ready)) tpbot_ready[bot_name] = false
    if(!(bot_name in tpbot_loc)) tpbot_loc[bot_name] = 'unknown'
    if(!(bot_name in tpbot_bed_loc)) tpbot_bed_loc[bot_name] = 'unknown'
    if(!(bot_name in tpbot_home_loc)) tpbot_home_loc[bot_name] = 'unknown'
    saveBotData()
    if(!(bot_name in tpbot_deaths)) tpbot_deaths[bot_name] = 0
    if(tpbot_ready[bot_name]){
        if(tp_who in tp_services_being_sold) tp_services_being_sold[tp_who]()
        return
    }
    console.log('getting tpbot online...')
    function rejoinIfNeeded(){if(tp_who in tp_services_being_sold) initTpBot(bot_name, OPTIONS, tp_who)}
    // might be join from another location
    function kickedForBadReason(){
        tpbot_loc[bot_name] = 'unknown'
        saveBotData()
        console.log(bot_name+' was kicked for a bad reason, setting loc=unknown')
    }
    let tpbot = functions.makeRejoiningBot(OPTIONS, /*inject=*/(bot)=>{}, rejoinIfNeeded, kickedForBadReason)
    tpbots[bot_name] = tpbot
    tpbot.on('message', (message) => {
        if(busy_doing_tp/* || proposed_hold_spot_until_ts > hold_spot_until_ts*/){
            console.log('|'+bot_name+'> '+message)
        }
        const msg = String(message)
        if(bot_name in tpbot_hold_spot_player && tpbot_loc[bot_name] === 'holdspot'){
            var dm_match = msg.match(/^\[\**(\w+) -> me\] /)
            if(dm_match && dm_match[1] === tpbot_hold_spot_player[bot_name]/* && msg.includes('tp')*/){
                var tp_who_match = msg.match(/^\[\**\w+ -> me\] (?:tp )?(?!me)(\w+)$/i)
                if(tp_who_match) tpbot.chat('/tpahere '+tp_who_match[1])
                else tpbot.chat('/tpahere '+tpbot_hold_spot_player[bot_name])
            }
        }
    })
    tpbot.on('spawn', () => {
        tpbot_ready[bot_name] = true
        setTimeout(() => {
            if(tpbot_ready[bot_name]){
                //console.log('initialized tpbot')
                tpbot.chat('/sit')
                if(tp_who in tp_services_being_sold) tp_services_being_sold[tp_who]()
            }
        }, 500) // 10 ticks
    })
    tpbot.on('death', () => {
        ++tpbot_deaths[bot_name]
        console.log('deaths: '+tpbot_deaths[bot_name])
        tpbot_loc[bot_name] = tpbot_bed_loc[bot_name]
        saveBotData()
        if(bot_name in tpbot_hold_spot_player){
            delete tpbot_hold_spot_player[bot_name]
            delete tpbot_hold_spot_until_ts[bot_name]
            delete tpbot_proposed_hold_spot_until_ts[bot_name]
        }
        if(tpbot_deaths[bot_name] >= 5){
            tpbot_ready[bot_name] = false
            tpbot.chat('dying makes me sad')
            tpbot.quit()
            tpbot_deaths[bot_name] = 0
        }
    })
    tpbot.on('end', ()=>tpbot_ready[bot_name]=false)
}

function returnToSethome(bot_name, home_name, sit=true, callback=()=>{}, bedUnsetCallback=()=>{}){
    if(!isBotReady(bot_name)){console.log('ERROR: unready bot for /home: '+bot_name); return}
    //busy_doing_tp = true
    tpbots[bot_name].chat('/home '+home_name)
    tpbots[bot_name].on('message', returnToHome)
    function returnToHome(message){
        const msg = String(message)
        if(msg === 'Teleportation commencing...'){
            tpbots[bot_name].removeListener('message', returnToHome)
            if(home_name === 'home') tpbot_loc[bot_name] = tpbot_home_loc[bot_name]
            else if(home_name === 'bed') tpbot_loc[bot_name] = tpbot_bed_loc[bot_name]
            else tpbot_loc[bot_name] = 'unknown'
            saveBotData()
            setTimeout(()=>{
                if(sit) tpbots[bot_name].chat('/sit')
                callback()
            }, 500) // 10 ticks
        }
        else if(msg === 'Error: Your bed is either unset, missing or blocked.'){
            tpbot_bed_loc[bot_name] = 'unset'
            saveBotData()
            bedUnsetCallback()
        }
    }
}

// send a /msg to a player and also log it to console
function sendMsg(who, msg, minimize=false){
    if(minimize){
        who = who.toLowerCase()
        let names = []
        for(let n in bot.players){
            const name = String(n).toLowerCase()
            if(name != who) names.push(name)
        }
        who = functions.shortestUniqueSubstr(who, names)
        console.log('optimized who: '+who)
    }
    let msg_cmd = '/m '+who+' '+msg
    if(msg_cmd.length <= 256) bot.chat(msg_cmd)
    else bot.chat(msg_cmd.substr(0, 253)+'...')
    //console.log('sent:'+msg_cmd)
}
// deduct credits and thank the customer
function completeSale(who, what, amount=1){
    // deduct credits
    const cost = amount*item_price[what]
    if(what != 'endtp') functions.addCredits(who, -cost)
    sendMsg(who, 'thank you for your business')
    let sale_data = '\n'+new Date().toLocaleString()+','+who+','+what+','+amount+','+item_price[what]
    fs.appendFile('sales.txt', sale_data, function(err){if(err) throw err;});
}

// load bot_data.txt file data
function loadBotDataFile(){
    let data = fs.readFileSync('bot_data.txt', 'utf8').toLowerCase()
    for(var line of data.split('\n')){
        if(line.startsWith('#')) continue
        if(line.indexOf(',') < 0){
            last_item_ad = line
            console.log('last_item_ad: '+last_item_ad)
            continue
        }
        let a = line.trim().split(',')
        if(a.length < 4) continue
        // bot_name, bot_loc, bot_bed_loc, bot_home_loc
        tpbot_loc[a[0]] = a[1]
        tpbot_bed_loc[a[0]] = a[2]
        tpbot_home_loc[a[0]] = a[3]
        console.log('bot:\''+a[0]+'\': loc:'+a[1]+', bed:'+a[2]+', home:'+a[3])
    }
}
function saveBotData(){
    let bot_data = '#last_item_ad\n'+last_item_ad+'\n#name-key,loc,bed,home'
    for(const name in tpbot_loc){
        bot_data += '\n'+name+','+tpbot_loc[name]+','+tpbot_bed_loc[name]+','+tpbot_home_loc[name]
    }
    fs.writeFile('bot_data.txt', bot_data, function(err){if(err) console.log(err)});
}

// load item.txt file data
function loadItemsFile(){
    let data = fs.readFileSync('items.txt', 'utf8')
    for(var line of data.split('\n')){
        if(line.startsWith('#')) continue
        let a = line.trim().split(',')
        if(a.length < 5) continue
        let name = a[0], fullname = a[1], sellname = a[2]
        let price = Number(a[3]), def_amt = Number(a[4])//, stock = Number(a[4])
        item_fullname_to_name[fullname] = name
        item_fullname[name] = fullname
        item_sellname[name] = sellname
        item_price[name] = price
        item_defamt[name] = def_amt
        item_stock[name] = 0
        min_item_name = Math.min(name.length, min_item_name)
        //console.log('parsed item:'+name+','+def_amt)
    }
    if(min_item_name < 4) console.log('min_item_name: '+min_item_name)
}

function hasFortune3(item){
    if(item.nbt.value.Enchantments){
        //console.log('item data: '+JSON.stringify(item))
        const fortune_ench = item.nbt.value.Enchantments.value.value
                .find(enchant => enchant.id.value.includes('fortune'))
        if(fortune_ench && fortune_ench.lvl.value >= 3) return true
    }
    return false
}
function isStock(item){
    if(item.name === 'diamond_pickaxe' && !hasFortune3(item)) return false
    const fullname = functions.getItemName(item)
    if(fullname in item_fullname_to_name) return item_fullname_to_name[fullname]
    return undefined
}

// load item_stock
function calculateItemStockAndProfits(){
    const old_revenue = cur_revenue
    //console.log('old rev: '+old_revenue)
    cur_revenue = 0
    for(const name in item_stock) if(!services_set.has(name)) item_stock[name] = 0
    for(const item of bot.inventory.items()){
        const value = functions.getCurrencyValue(item.name) * item.count
        if(value > 0) cur_revenue += value
        const name = isStock(item)
        if(name) item_stock[name] += item.count
    }
    //console.log('new rev: '+cur_revenue)
    if(cur_revenue > old_revenue && cur_player){
        const add_credits = cur_revenue - old_revenue
        console.log('credit +'+add_credits+' to '+cur_player)
        const new_credits = functions.addCredits(cur_player, add_credits)
        sendMsg(cur_player, 'you now have '+new_credits+' credits')
    }
}

// throw out trash items
function throwOutTrashItems(){
    //console.log('potentially throwing out trash')
    for(const item of bot.inventory.items()){
        if(item === null) continue
        if(functions.getCurrencyValue(item.name) > 0 || isStock(item)) continue
        console.log('trashing: '+item.name)
        bot.tossStack(item)
        setTimeout(throwOutTrashItems, 1500) // in 30 ticks
        return
    }
}

// look at nearest player (negative pitch is up)
let min_pitch = -75*(Math.PI/180)  // 75 degrees to radians
let max_pitch = 40*(Math.PI/180)  // 40 degrees to radians
function updateNearestPlayer(lookAt=true){
    const player = bot.nearestEntity((entity) => entity.type === 'player')
    if (!player) return
    cur_player = player.username.toLowerCase()
    var sitting_offset = 0.5
    if(lookAt){
        let player_vec = player.position.offset(0, player.height+sitting_offset, 0);
        let pitch_vec = player_vec.clone().subtract(bot.entity.position).normalize()
        let pitch = Math.asin(-pitch_vec.y);
        //console.log('min_pitch: '+min_pitch+', max_pitch: '+max_pitch+', pitch: '+pitch)
        if(min_pitch <= pitch && pitch <= max_pitch) bot.lookAt(player_vec)
    }
}

function simplifyItemName(name){
    return name.toLowerCase()
        .replace(/north ?east/, 'netp').replace(/north ?west/, 'nwtp')
        .replace(/south ?east/, 'setp').replace(/south ?east/, 'swtp')
        .replace('sb ', 'sb:').replace('of ', '')
        .replace(/north (corner|border|tp)/, 'netp').replace(/south (corner|border|tp)/, 'setp')
        .replace(/([n|s|\+|\-][e|w|\+|\-]) (corner|border|tp)/, '$1tp')
        .replace('+-', 'ne').replace('--', 'nw').replace('++', 'se').replace('-+', 'sw')
        .replace(/\-X (corner|border|tp)/, 'nwtp'/*or sw*/)
        .replace(/\+X (corner|border|tp)/, 'netp'/*or se*/)
        .replace(/\-Z (corner|border|tp)/, 'netp'/*or nw*/)
        .replace(/\+Z (corner|border|tp)/, 'setp'/*or sw*/)
        .replace('cornertp', 'netp')  // default netp when they do not specify a corner
        .replace(/end (portal )?(teleport|tp)/, 'endtp')
        .replace('unsubscribe', 'weather_psa')
        .replace(/ender[_ ]?pearl/, 'epearl')
        .replace(/endportal( tp)?/, 'endtp')
        .replace(/please|pls|plz/, '')
        .replace('gunpowder', 'gp')
        .replace('s.shell', 'shell')
        .replace('warp', 'tp')
        .replace(/[\s\.-_]+/g, '')
}

// get the item the player is requesting
function getItem(msg){
    //loadItemsFile()
    let amt = null, name = null;
    msg = msg.replace(/^one /, '1 ').replace(/^two /, '2 ').replace(/^three /, '3 ')
            .replace(/^four /, '4 ').replace(/^five /, '5 ').replace(/^six /, '6 ')
            .replace(/^seven /, '7 ').replace(/^eight /, '8 ').replace(/^nine /, '9 ')
    let correct_format = /^\d+ [\w ]+/.test(msg)
    if(correct_format){
        let i = msg.indexOf(' ')
        amt = Number(msg.substr(0, i))
        name = simplifyItemName(msg.substr(i + 1))
    }
    if(name != null) for(const n in item_sellname){
        const s_n = simplifyItemName(n)
        const sellname = simplifyItemName(item_sellname[n])
        if(s_n.includes(name) || name.includes(s_n) || sellname.includes(name) || name.includes(sellname)){
            console.log('[amt] [item]:'+amt+' '+n)
            calculateItemStockAndProfits()////////////////////
            return [n, amt, correct_format]
        }
    }
    if(msg.length < min_item_name){
        console.log('[msg too short]: '+msg)
        return [null, null, correct_format]
    }
    const s_msg = simplifyItemName(msg)
    for(const n in item_sellname){
        const s_n = simplifyItemName(n)
        const sellname = simplifyItemName(item_sellname[n])
        if(s_n.includes(s_msg) || s_msg.includes(s_n) || sellname.includes(s_msg) || s_msg.includes(sellname)){
            console.log('[from msg: '+s_msg+']:'+n)
            return [n, null, correct_format]
        }
        for(var word of msg.split(' ')){
            if(word.length < min_item_name) continue
            word = simplifyItemName(word)
            if(s_n.includes(word) || word.includes(s_n) || sellname.includes(word) || word.includes(sellname)){
                console.log('[from word in msg: '+word+']:'+n)
                return [n, null, correct_format]
            }
        }
    }
    console.log('[item not found from msg]: '+msg)
    return [null, null, correct_format]
}

// sell the requested item
function sellItem(who, name, amount, bot_name){
}

function sellEndTp(who, bot_name){
}

function sellHoldSpot(who, amount, bot_name){
}

function sellCornerTp(who, corner, bot_name, corner_bot_name){
}

function sellItemOrService(who, name, amount){
    switch(name){
        case 'endtp':
            //sendMsg(who, 'selling: end tp')
            if(!isBotReady('tpbot')) sendMsg(who, 'one moment...')
            tp_services_being_sold[who] = ()=>sellEndTp(who, 'tpbot')
            initTpBot('tpbot', TPBOT_OPTIONS, who)
            return
        case 'holdspot':
            //sendMsg(who, 'selling: hold a spot')
            if(!isBotReady('tpbot')) sendMsg(who, 'one moment...')
            tp_services_being_sold[who] = ()=>sellHoldSpot(who, amount, 'tpbot')
            initTpBot('tpbot', TPBOT_OPTIONS, who)
            return
        case 'netp': case 'nwtp': case 'setp': case 'swtp':
            sendMsg(who, 'selling: '+name.substr(0, 2).toUpperCase()+' world corner tp')
            if(!isBotReady('tpbot') || tpbot_loc['tpbot'] != name) sendMsg(who, 'one moment...')
            tp_services_being_sold[who] = ()=>{
                const corner_bot_name = (name[0] === 'n' ? 'north' : 'south')+'-tpbot'
                if(tpbot_loc['tpbot'] == name){
                    sellCornerTp(who, name, 'tpbot', corner_bot_name)
                }
                else{
                    const OPTIONS = {
                        host: '',
                        username: '',
                        password: '',
                        auth: ''
                    }
                    tp_services_being_sold[who] = ()=>sellCornerTp(who, name, 'tpbot', corner_bot_name)
                    initTpBot(corner_bot_name, OPTIONS, who)
                }
            }
            initTpBot('tpbot', TPBOT_OPTIONS, who)
            return
        case 'weather_psa':
            if(weather_subscribers_set.has(who)){
                functions.setWeatherSubscribed(who, 'false')
                weather_subscribers_set.delete(who)
                sendMsg(who, 'You are now unsubscribed from weather alerts')
            }
            else{
                functions.setWeatherSubscribed(who, 'true')
                weather_subscribers_set.add(who)
                sendMsg(who, 'You are now subscribed to weather alerts')
                completeSale(who, name, 1)
            }
            return
        default:
            sellItem(who, name, amount)
    }
}

// send an ad
function sendAd(name){
    const sellname = item_sellname[name].replace(/sb (?!of)/, 'sb of ')
    bot.chat('Selling '+sellname+' for '+item_price[name]+', msg me if interested')
    saveBotData()
}
function sendNextAd(){
    bad_counter = {}
    let sell_next_item = false
    for(const name in item_stock){
        if(name === last_item_ad) sell_next_item = true
        else if(sell_next_item && item_stock[name] > 0){
            last_item_ad = name
            sendAd(name)
            return
        }
    }
    for(const name in item_stock){
        if(item_stock[name] > 0){
            last_item_ad = name
            sendAd(name)
            return
        }
    }
}

bot.on('spawn', () => {
    loadBotDataFile()
    loadItemsFile()
    for(const name of services_set) item_stock[name] = 9999
    if(!anyBotHasAccess('netp')) item_stock['netp'] = 0
    if(!anyBotHasAccess('nwtp')) item_stock['nwtp'] = 0
    if(!anyBotHasAccess('setp')) item_stock['setp'] = 0
    if(!anyBotHasAccess('swtp')) item_stock['swtp'] = 0
    weather_subscribers_set = functions.getWeatherSubscribers()
    calculateItemStockAndProfits()
    var out_of_stock = []
    for(const n in item_stock) if(item_stock[n] === 0) out_of_stock.push(n)
    if(out_of_stock.length > 0) console.log('out of stock of: '+out_of_stock.join(', '))
    setInterval(updateNearestPlayer, 1000) // every 20 ticks
})

// log chats from players between ads
bot.on('chat', (username, message) => {
    if(++chats_since_last_ad > 50){
        //cconsole.log('chats since last ad: '+chats_since_last_ad)
        let mins_since_epoch = Date.now() / 1000 / 60
        if(mins_since_epoch - last_ad_epoch_mins > 30){
            setTimeout(sendNextAd, 3000)  // 3s so it seems more spontaneous
            chats_since_last_ad = 0
            last_ad_epoch_mins = mins_since_epoch
        }
    }
})

// credits, restock, & trash
bot.on('playerCollect', (collector, collected) => {
    if(collector === bot.entity && collected.type === 'object'){
        setTimeout(calculateItemStockAndProfits, 250) // in 5 ticks
        setTimeout(throwOutTrashItems, 500) // in 10 ticks
    }
})

// generate a list of 'item=price'
function getShopItemsLists(who, credits){
    let item_name_list = [], item_sellname_list = []
    var merged_logs = false, merged_corner_tps = false
    for(const n in item_price){
        if(item_stock[n] > 0){
            const sellname = item_sellname[n].replace('sb ', 'sb:')
            if(/^sb:\w+.logs$/.test(sellname)){
                if(merged_logs) continue; merged_logs = true
                item_sellname_list.push('sb:<log-type>=~'+item_price[n])
                item_name_list.push('[log]')
            }
            else if(/^\w\w.corner.tp$/.test(sellname)){
                if(merged_corner_tps) continue; merged_corner_tps = true
                item_sellname_list.push('<world-corner>-tp=~'+item_price[n])
                item_name_list.push('cornertp')
            }
            else if(n === 'shell' && credits > 0){
                item_sellname_list.push('s.shell='+item_price[n])
                item_name_list.push('s_shell')
            }
            else if(n === 'weather_psa' && weather_subscribers_set.has(who)) continue
            else{
                item_sellname_list.push(sellname+'='+item_price[n])
                item_name_list.push(n.startsWith('sb:') ? '['+n.substr(3)+']' : n)
            }
        }
    }
    return [item_name_list, item_sellname_list]
}

// bot chat interaction
let skip_msgs = false
let skip_shop_check = false
let skip_item_check = false
bot.on('message', (message, position) => {
    if(!handle_message.handleAndSeeIfUnhandledDM(bot, message, position)) return
    let msg = String(message).toLowerCase()
    let tpahere_match = msg.match(/^(\w+) has requested that you teleport to them.$/)
    if(tpahere_match && proposed_hold_spot_until_ts > 0 && proposed_hold_spot_until_ts > Date.now()){
        sendMsg(tpahere_match[1], 'sorry wrong account, do /tpahere TpBot')
        return
    }
    if(skip_msgs) return; skip_msgs=true; setTimeout(()=>skip_msgs=false, 500)  // wait 10ticks between msgs
    let who = msg.substr(1, msg.indexOf(' ')-1)  // get who DM'd
    if(who[0] === '*') who = who.substr(1)
    msg = msg.substr(msg.indexOf('] ')+2)  // get DM contents
    //console.log('msg:'+who+':"'+msg+'"')

    // list your credits / store prices
    if(/credd?it/.test(msg) || /balance/.test(msg) || /stock/.test(msg)
            || /how much/.test(msg) || /shop/.test(msg) || /sale/.test(msg) || /sell/.test(msg)){
        if(skip_shop_check) return; skip_shop_check=true; setTimeout(()=>skip_shop_check=false, 3000)  // wait 3s
        const credits = functions.getCredits(who)
        const item_lists = getShopItemsLists(who, credits)

        if(item_lists[0].length === 0){
            sendMsg(who, 'I am currently unavailable, sorry')
            return
        }
        if(/stock/.test(msg)){
            //const item_list_wo_price = item_list.join(', ').replace(/=-?\d+,/g, ',')
            sendMsg(who, 'In stock: '+item_lists[0].join(', '), /*minimize=*/true)
        }
        else if(credits === 0 || (!/credd?it?s?/.test(msg) && !/balance/.test(msg))){
            //sendMsg(who, 'Currently on sale (item=price in dia):')
            sendMsg(who, /*'On sale: '+*/item_lists[1].join(' | '), /*minimize=*/true)
        }
        if(credits > 0) sendMsg(who, 'You have '+credits+' credits')
        else{
            sendMsg(who, 'To buy, toss me dia then /msg me item & amt')
            if(!functions.isNearby(bot, who, 25)) sendMsg(who, "I'm at spawn")
        }
        return
    }
    // get item & amount requested
    if(skip_item_check) return; skip_item_check=true; setTimeout(()=>skip_item_check=false, 1000)  // wait 1s
    let item_amt_correct = getItem(msg)
    let name = item_amt_correct[0], amt = item_amt_correct[1]
    if(name == null){
        if(item_amt_correct[2]) sendMsg(who, 'unknown item, msg me "shop" for available items')
        else{
            if(who in bad_counter) ++bad_counter[who]
            else bad_counter[who] = 1
            if(bad_counter[who] < 5) sendMsg(who, 'bad')
        }
        return
    }
    if(item_stock[name] <= 0){
        sendMsg(who, 'sorry, out of stock of "'+name+'" currently. Restock within 12h')
        return
    }
    if(item_stock[name] < amt){
        sendMsg(who, 'sorry, I only have '+item_stock[name]+' '+name+' right now')
        return
    }
    const credits = functions.getCredits(who)
    console.log(who+' has '+credits+' credits')
    console.log('stock of '+name+': '+item_stock[name])
    let needed_credits = (amt === null ? 1 : amt)*item_price[name]
    if(credits < needed_credits && (!weather_subscribers_set.has(who) || name != 'weather_psa')) {
        sendMsg(who, 'you don\'t have enough credits (have:'+credits+', need:'+needed_credits+')')
        return
    }
    if(amt === null){
        if(services_set.has(name)) amt = 1
        else{
            console.log('default_amt:'+item_defamt[name]+', item_stock:'+item_stock[name]+', credits:'+credits)
            let amt_to_buy = msg.replace(/^\D* (\d+)\D*$/, '$1') //=> '123'
            let max_to_buy = Math.min(item_defamt[name], item_stock[name], credits)
            if(amt_to_buy === msg || Number(amt_to_buy) > max_to_buy) amt_to_buy = max_to_buy
            var msg_format = 'try like this: '
                +'"/msg '+bot.username
                +' '+amt_to_buy
                +' '+name+'"'
            sendMsg(who, msg_format)
            return
        }
    }
    if(amt === 0){
        sendMsg(who, 'thank you for your business :P')
        return
    }
    if(cur_player != who && !services_set.has(name)){
        if(functions.isNearby(bot, who)){
            sendMsg(who, 'come nearer to me')
            var num_invis = functions.numNearbyInvisPlayers(bot, who)
            if(num_invis === 1) sendMsg(who, 'look out, an invis player is here')
            if(num_invis > 1) sendMsg(who, 'look out, invis players are here')
        }
        else{
            sendMsg(who, "come here (I'm at spawn)")
        }
        return
    }
    sellItemOrService(who, name, amt)
})
}
