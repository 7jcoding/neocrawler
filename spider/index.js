/**
 * spider core
 */
var util = require('util');
var events = require('events');
var redis = require("redis");
var crypto = require('crypto');
var logger;
////spider core/////////////////////////////////////////
var spiderCore = function(settings){
    events.EventEmitter.call(this);//eventemitter inherits
    this.settings = settings;
    this.queue_length = 0;
    this.driller_rules_updated = 0;
    this.driller_rules = {};
    this.downloader = new(require('./downloader.js'))(this);
    this.extractor = new(require('./extractor.js'))(this);
    this.pipeline = new(require('./pipeline.js'))(this);
    logger = settings.logger;
}
util.inherits(spiderCore, events.EventEmitter);//eventemitter inherits
//refresh the driller rules//////////////////////////////
spiderCore.prototype.refreshDrillerRules = function(){
    var spiderCore = this;
    var redis_cli = redis.createClient(this.settings['driller_info_redis_db'][1],this.settings['driller_info_redis_db'][0]);
    redis_cli.select(this.settings['driller_info_redis_db'][2], function(err, value) {
        if (err)throw(err);
        redis_cli.get('updated:driller:rule',function(err,value){
            if (err)throw(err);
            if(this.driller_rules_updated!==parseInt(value)){//driller is changed
                logger.debug('driller rules is changed');

                redis_cli.keys('driller:*',function(err,values){
                    if (err)throw(err);
                    spiderCore.tmp_driller_rules = {};
                    spiderCore.tmp_driller_rules_length = values.length;
                    for(var i=0;i<values.length;i++){
                        (function(key,spiderCore){
                            redis_cli.hgetall(key, function(err,value){//for synchronized using object variable
                                if(spiderCore.tmp_driller_rules==undefined)spiderCore.tmp_driller_rules = {};
                                if(spiderCore.tmp_driller_rules[value['domain']]==undefined)spiderCore.tmp_driller_rules[value['domain']]={};
                                spiderCore.tmp_driller_rules[value['domain']][value['alias']] = value;
                                spiderCore.tmp_driller_rules_length--;
                                if(spiderCore.tmp_driller_rules_length<=0){
                                    spiderCore.driller_rules = spiderCore.tmp_driller_rules;
                                    spiderCore.driller_rules_updated = (new Date()).getTime();
                                    spiderCore.emit('driller_reules_loaded',spiderCore.driller_rules);
                                    setTimeout(function(){spiderCore.refreshDrillerRules();},spiderCore.settings['check_driller_rules_interval']);
                                    redis_cli.quit();
                                }
                            });
                        })(values[i],spiderCore);
                    }
                });
                this.driller_rules_updated=parseInt(value);
            }else{
                logger.debug('driller rules is not changed');
                setTimeout(function(){spiderCore.refreshDrillerRules();},spiderCore.settings['check_driller_rules_interval']);
                redis_cli.quit();
            }
        })

    });
}
////get url////////////////////////////////////////////
spiderCore.prototype.getUrlQueue = function(){
    /*
    var urlinfo = {
        "url":"http://list.taobao.com/itemlist/sport2011a.htm?spm=1.6659421.a21471u.6.RQYJRM&&md=5221&cat=50071853&sd=0&as=0&viewIndex=1&atype=b&style=grid&same_info=1&tid=0&olu=yes&isnew=2&smc=1&navid=city&_input_charset=utf-8",
        "type":"branch",
        "referer":"http://www.taobao.com",
        "cookie":[],//require('./taobao-cookie-simple.json'),
        "jshandle":true,
        "inject_jquery":false,
        "drill_rules":[".vm-page-next",".general a","a"],
        "script":["jsexec_result = document.getElementById('pageJumpto').value;","jsexec_result=document.querySelector('.user-nick').text"],//["jsexec_result = $.map($('.category li a span'),function(n,i) {return $(n).text();});"],//["jsexec_result=document.querySelector('.user-nick').text;"]
        "navigate_rule":[".vm-page-next"],
        "stoppage":3,
        "url_lib_id":"urllib:driller:taobao.com:list"
    }
    */

    var spiderCore = this;
    var redis_driller_db = redis.createClient(this.settings['driller_info_redis_db'][1],this.settings['driller_info_redis_db'][0]);
    var redis_urlinfo_db = redis.createClient(spiderCore.settings['url_info_redis_db'][1],spiderCore.settings['url_info_redis_db'][0]);
    redis_driller_db.select(spiderCore.settings['driller_info_redis_db'][2], function(err, signal) {
        //1-------------------------------------------------------------------------------------------
        if(err)throw(err);
        redis_driller_db.lpop('queue:scheduled:all',function(err, link){
            //2----------------------------------------------------------------------------------------
            if(err)throw(err);
            if(!link){
                logger.debug('No queue~');
                redis_driller_db.quit();
                redis_urlinfo_db.quit();
                return;
            };//no queue
            redis_urlinfo_db.select(spiderCore.settings['url_info_redis_db'][2], function(err, signal) {
                //3-------------------------------------------------------------------------------------
                if(err)throw(err);
                var linkhash = crypto.createHash('md5').update(link).digest('hex');
                redis_urlinfo_db.hgetall(linkhash,function(err, link_info){
                    //4---------------------------------------------------------------------------------
                    if(err)throw(err);
                    if(!link_info){
                        logger.warn(link+' has no url info, '+linkhash);
                        redis_driller_db.quit();
                        redis_urlinfo_db.quit();
                        spiderCore.getUrlQueue();
                    }else{
                        if(!link_info['trace']){
                            logger.warn(link+', url info is incomplete');
                            redis_driller_db.quit();
                            redis_urlinfo_db.quit();
                            spiderCore.getUrlQueue();
                        }else{
                            redis_driller_db.hgetall(link_info['trace'].slice(link_info['trace'].indexOf(':')+1),function(err, drillerinfo){
                                //5---------------------------------------------------------------------
                                if(err)throw(err);
                                if(drillerinfo==null){
                                    logger.warn(link+', has no driller info!');
                                    redis_driller_db.quit();
                                    redis_urlinfo_db.quit();
                                    spiderCore.getUrlQueue();
                                }else{
                                    var urlinfo = {
                                        "url":link,
                                        "type":drillerinfo['type'],
                                        "referer":link_info['referer'],
                                        "save_page":JSON.parse(drillerinfo['save_page']),
                                        "cookie":JSON.parse(drillerinfo['save_page']),
                                        "jshandle":JSON.parse(drillerinfo['jshandle']),
                                        "inject_jquery":JSON.parse(drillerinfo['inject_jquery']),
                                        "drill_rules":JSON.parse(drillerinfo['drill_rules']),
                                        "script":JSON.parse(drillerinfo['script']),
                                        "navigate_rule":JSON.parse(drillerinfo['navigate_rule']),
                                        "stoppage":parseInt(drillerinfo['stoppage'])
                                    }
                                    logger.debug('new url: '+link);
                                    spiderCore.queue_length++;
                                    spiderCore.emit('new_url_queue',urlinfo);
                                    redis_driller_db.quit();
                                    redis_urlinfo_db.quit();
                                }
                                //5----------------------------------------------------------------------
                            });
                        }
                    }
                    //4-----------------------------------------------------------------------------------
                });
                //3---------------------------------------------------------------------------------------
            });
            //2-------------------------------------------------------------------------------------------
        });
    //1---------------------------------------------------------------------------------------------------
    });

}

spiderCore.prototype.__checkQueue = function(spiderCore){
    logger.debug('Check queue, length: '+spiderCore.queue_length);
    var slide_count = spiderCore.settings['spider_concurrency'] - spiderCore.queue_length;
    for(var i=0;i<slide_count;i++){
        spiderCore.getUrlQueue();
    }
}
//get test url queue
spiderCore.prototype.getTestUrlQueue = function(link){
    var spiderCore = this;
    var redis_driller_db = redis.createClient(this.settings['driller_info_redis_db'][1],this.settings['driller_info_redis_db'][0]);
    var redis_urlinfo_db = redis.createClient(spiderCore.settings['url_info_redis_db'][1],spiderCore.settings['url_info_redis_db'][0]);
    redis_driller_db.select(spiderCore.settings['driller_info_redis_db'][2], function(err, signal) {
        //1-------------------------------------------------------------------------------------------
        if(err)throw(err);

            if(err)throw(err);
            if(!link){
                logger.debug('No queue~');
                redis_driller_db.quit();
                redis_urlinfo_db.quit();
                return;
            };//no queue
            redis_urlinfo_db.select(spiderCore.settings['url_info_redis_db'][2], function(err, signal) {
                //3-------------------------------------------------------------------------------------
                if(err)throw(err);
                var linkhash = crypto.createHash('md5').update(link).digest('hex');
                redis_urlinfo_db.hgetall(linkhash,function(err, link_info){
                    //4---------------------------------------------------------------------------------
                    if(err)throw(err);
                    if(!link_info){
                        logger.warn(link+' has no url info, '+linkhash);
                        redis_driller_db.quit();
                        redis_urlinfo_db.quit();
                        spiderCore.getUrlQueue();
                    }else{
                        if(!link_info['trace']){
                            logger.warn(link+', url info is incomplete');
                            redis_driller_db.quit();
                            redis_urlinfo_db.quit();
                            spiderCore.getUrlQueue();
                        }else{
                            redis_driller_db.hgetall(link_info['trace'].slice(link_info['trace'].indexOf(':')+1),function(err, drillerinfo){
                                //5---------------------------------------------------------------------
                                if(err)throw(err);
                                if(drillerinfo==null){
                                    logger.warn(link+', has no driller info!');
                                    redis_driller_db.quit();
                                    redis_urlinfo_db.quit();
                                    spiderCore.getUrlQueue();
                                }else{
                                    var urlinfo = {
                                        "url":link,
                                        "type":drillerinfo['type'],
                                        "referer":link_info['referer'],
                                        "save_page":JSON.parse(drillerinfo['save_page']),
                                        "cookie":JSON.parse(drillerinfo['save_page']),
                                        "jshandle":JSON.parse(drillerinfo['jshandle']),
                                        "inject_jquery":JSON.parse(drillerinfo['inject_jquery']),
                                        "drill_rules":JSON.parse(drillerinfo['drill_rules']),
                                        "script":JSON.parse(drillerinfo['script']),
                                        "navigate_rule":JSON.parse(drillerinfo['navigate_rule']),
                                        "stoppage":parseInt(drillerinfo['stoppage'])
                                    }
                                    logger.debug('new url: '+JSON.stringify(urlinfo));
                                    spiderCore.queue_length++;
                                    spiderCore.emit('new_url_queue',urlinfo);
                                    redis_driller_db.quit();
                                    redis_urlinfo_db.quit();
                                }
                                //5----------------------------------------------------------------------
                            });
                        }
                    }
                    //4-----------------------------------------------------------------------------------
                });
                //3---------------------------------------------------------------------------------------
            });

        //1---------------------------------------------------------------------------------------------------
    });

}

////start///////////////////////////////////////////////
spiderCore.prototype.start = function(){
    this.on('new_url_queue',function(urlinfo){
        this.downloader.download(urlinfo);
    });

    this.on('crawled',function(crawled_info){
        logger.debug('crawl '+crawled_info['url']+' finish');
        var extracted_info = this.extractor.extract(crawled_info);
        this.pipeline.save(extracted_info);
        this.emit('slide_queue');
    });

    this.on('slide_queue',function(){
        if(this.queue_length>0)this.queue_length--;
        this.__checkQueue(this);
    });

    this.once('driller_reules_loaded',function(rules){
        this.emit('slide_queue');
        spiderCore = this;
        setInterval(function(){spiderCore.__checkQueue(spiderCore);},120000);
    });

    //trigger
    this.refreshDrillerRules();
}

//test url//////////////////////////////////////////////
spiderCore.prototype.test = function(link){
    this.on('new_url_queue',function(urlinfo){
        this.downloader.download(urlinfo);
        logger.debug('download url :'+urlinfo['url']);
    });

    this.on('crawled',function(crawled_info){
        logger.debug('crawl '+crawled_info['url']+' finish');
        var extracted_info = this.extractor.extract(crawled_info);
        this.pipeline.save(extracted_info);
    });

    this.once('driller_reules_loaded',function(rules){
        var linkobj = this.extractor.arrange_link([link]);
        this.pipeline.save_links(link,linkobj);
        this.getTestUrlQueue(link);
    });

    //trigger
    this.refreshDrillerRules();
}
////////////////////////////////////////////////////////
module.exports = spiderCore;