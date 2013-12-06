/**
 * spider core
 */
var util = require('util');
var events = require('events');
require('../lib/jsextend.js');

var logger;
////spider core/////////////////////////////////////////
var spiderCore = function(settings){
    events.EventEmitter.call(this);//eventemitter inherits
    this.settings = settings;
    this.spider = new(require('./spider.js'))(this);
    this.downloader = new(require('./downloader.js'))(this);
    this.extractor = new(require('./extractor.js'))(this);
    this.pipeline = new(require('./pipeline.js'))(this);
    logger = settings.logger;
}
util.inherits(spiderCore, events.EventEmitter);//eventemitter inherits

spiderCore.prototype.assembly = function(){
    this.unavailable_middlewares = {
        'spider':true,
        'downloader':true,
        'extractor':true,
        'pipeline':true
    }
    this.spider.assembly();
    this.downloader.assembly();
    this.extractor.assembly();
    this.pipeline.assembly();
}

////start///////////////////////////////////////////////
spiderCore.prototype.start = function(){

    this.on('standby',function(middleware){
        logger.debug(middleware+' stand by');
        delete this.unavailable_middlewares[middleware];
        if(this.unavailable_middlewares.isEmpty()){
            logger.debug('All middlewares stand by');
            this.removeAllListeners('standby');
            this.spider.refreshDrillerRules();
        }
    });

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
        if(this.spider.queue_length>0)this.spider.queue_length--;
        this.spider.checkQueue(this.spider);
    });

    this.once('driller_reules_loaded',function(rules){
        this.emit('slide_queue');
        var spiderIns = this.spider;
        setInterval(function(){spiderIns.checkQueue(spiderIns);},120000);
    });

    //trigger
    this.assembly();

}

//test url//////////////////////////////////////////////
spiderCore.prototype.test = function(link){
    this.on('standby',function(middleware){
        logger.debug(middleware+' stand by');
        delete this.unavailable_middlewares[middleware];
        logger.debug(JSON.stringify(this.unavailable_middlewares));
        if(this.unavailable_middlewares.isEmpty()){
            logger.debug('All middlewares stand by');
            this.removeAllListeners('standby');
            this.spider.refreshDrillerRules();
        }
    });

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
    });

    this.once('append_link',function(){
        this.spider.getTestUrlQueue(link);
    });

    //trigger
    this.assembly();
}
////////////////////////////////////////////////////////
module.exports = spiderCore;