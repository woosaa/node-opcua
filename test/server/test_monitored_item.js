require("requirish")._(module);

var MonitoredItem = require("lib/server/monitored_item").MonitoredItem;
var StatusCodes = require("lib/datamodel/opcua_status_code").StatusCodes;
var subscription_service = require("lib/services/subscription_service");
var MonitoringMode = subscription_service.MonitoringMode;
var MonitoringParameters = subscription_service.MonitoringParameters;

var read_service = require("lib/services/read_service");
var TimestampsToReturn = read_service.TimestampsToReturn;

var DataType = require("lib/datamodel/variant").DataType;
var DataValue = require("lib/datamodel/datavalue").DataValue;
var Variant = require("lib/datamodel/variant").Variant;

var sinon = require("sinon");
var should = require("should");

var resourceLeakDetector = require("test/helpers/resource_leak_detector").resourceLeakDetector;

describe("Server Side MonitoredItem",function(){

    before(function() {
        resourceLeakDetector.start();
    });
    after(function() {
        resourceLeakDetector.stop();
    });

    beforeEach(function(){
        this.clock = sinon.useFakeTimers();
    });

    afterEach(function(){
        this.clock.restore();
    });

    it("should create a MonitoredItem",function(done){

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 1000,
            discardOldest: true,
            queueSize: 100,
            // added by the server:
            monitoredItemId: 50

        });

        monitoredItem.clientHandle.should.eql(1);
        monitoredItem.samplingInterval.should.eql(1000);
        monitoredItem.discardOldest.should.eql(true);
        monitoredItem.queueSize.should.eql(100);
        monitoredItem.queue.should.eql([]);
        monitoredItem.monitoredItemId.should.eql(50);

        monitoredItem.terminate();
        done();
    });

    it("a MonitoredItem should trigger a read event according to sampling interval in Reporting mode",function(done){

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 100,
            // added by the server:
            monitoredItemId: 50
        });
        monitoredItem.setMonitoringMode(MonitoringMode.Reporting);

        monitoredItem.oldValue = new Variant({dataType: DataType.UInt32, value: 42});
        var spy_samplingEventCall = sinon.spy();
        monitoredItem.on("samplingEvent",spy_samplingEventCall);

        this.clock.tick(2000);
        spy_samplingEventCall.callCount.should.be.greaterThan(6);

        monitoredItem.terminate();
        done();
    });

    it("a MonitoredItem should record a new value and store it in a queue",function(done){

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 100,
            // added by the server:
            monitoredItemId: 50
        });

        monitoredItem.queue.length.should.eql(0);
        this.clock.tick(2000);
        monitoredItem.recordValue({value:{dataType: DataType.UInt32, value: 1000 }});
        monitoredItem.queue.length.should.eql(1);

        monitoredItem.terminate();
        done();
    });

    it("a MonitoredItem should discard old value from the queue when discardOldest is true",function(done){

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true, // <= discard oldest !
            queueSize: 2,         // <=== only 2 values in queue
            // added by the server:
            monitoredItemId: 50
        });

        monitoredItem.queue.length.should.eql(0);
        this.clock.tick(100);
        monitoredItem.recordValue({value:{dataType: DataType.UInt32, value: 1000 }});
        monitoredItem.queue.length.should.eql(1);
        monitoredItem.overflow.should.eql(false);

        this.clock.tick(100);
        monitoredItem.recordValue({value:{dataType: DataType.UInt32, value: 1001 }});
        monitoredItem.queue.length.should.eql(2);
        monitoredItem.queue[0].value.value.should.eql(1000);
        monitoredItem.queue[1].value.value.should.eql(1001);
        monitoredItem.overflow.should.eql(false);

        this.clock.tick(100);
        monitoredItem.recordValue({value:{dataType: DataType.UInt32, value: 1002 }});
        monitoredItem.queue.length.should.eql(2);
        monitoredItem.queue[0].value.value.should.eql(1001);
        monitoredItem.queue[1].value.value.should.eql(1002);
        monitoredItem.overflow.should.eql(true);

        monitoredItem.terminate();
        done();
    });

    it("a MonitoredItem should not accept new value when queue is full when discardOldest is false",function(done){

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: false, // <= discard oldest !
            queueSize: 2,         // <=== only 2 values in queue
            // added by the server:
            monitoredItemId: 50
        });

        monitoredItem.queue.length.should.eql(0);
        this.clock.tick(100);
        monitoredItem.recordValue({value:{dataType: DataType.UInt32, value: 1000 }});
        monitoredItem.queue.length.should.eql(1);
        monitoredItem.overflow.should.eql(false);

        this.clock.tick(100);
        monitoredItem.recordValue({value:{dataType: DataType.UInt32, value: 1001 }});
        monitoredItem.queue.length.should.eql(2);
        monitoredItem.queue[0].value.value.should.eql(1000);
        monitoredItem.queue[1].value.value.should.eql(1001);
        monitoredItem.overflow.should.eql(false);

        this.clock.tick(100);
        monitoredItem.recordValue({value:{dataType: DataType.UInt32, value: 1002 }});
        monitoredItem.queue.length.should.eql(2);
        monitoredItem.queue[0].value.value.should.eql(1000);
        monitoredItem.queue[1].value.value.should.eql(1001);
        monitoredItem.overflow.should.eql(true);

        monitoredItem.terminate();
        done();
    });

    it("should set timestamp to the recorded value without timestamp (variation 1)", function(done){

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 2,  // <=== only 2 values in queue
            // added by the server:
            monitoredItemId: 50,
            timestampsToReturn: TimestampsToReturn.Both
        });

        this.clock.tick(100);
        var now = new Date();

        monitoredItem.recordValue(new DataValue({
            value:{dataType: DataType.UInt32, value: 1000 },
            serverTimestamp: now,
            sourceTimestamp: now
        }));

        monitoredItem.queue.length.should.eql(1);
        monitoredItem.queue[0].serverTimestamp.should.eql(now);
        monitoredItem.queue[0].sourceTimestamp.should.eql(now);

        monitoredItem.terminate();
        done();
    });

    // #21
    it("should set timestamp to the recorded value with a given sourceTimestamp (variation 2)", function(done) {

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 2,  // <=== only 2 values in queue
            // added by the server:
            monitoredItemId: 50,
            timestampsToReturn: TimestampsToReturn.Both
        });

        this.clock.tick(100);
        var now = new Date();

        var sourceTimestamp = new Date(Date.UTC(2000,0,1));
        sourceTimestamp.setMilliseconds(100);
        var picoSeconds = 456;

        monitoredItem.recordValue(new DataValue({
            value: {dataType: DataType.UInt32, value: 1000},
            sourceTimestamp: sourceTimestamp,
            sourcePicoseconds:picoSeconds,
            serverTimestamp: now
        }));

        monitoredItem.queue.length.should.eql(1);
        monitoredItem.queue[0].serverTimestamp.should.eql(now);

        monitoredItem.queue[0].sourceTimestamp.should.eql(sourceTimestamp);

        monitoredItem.terminate();
        done();

    });


    it("a MonitoredItem should trigger a read event according to sampling interval",function(done){

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 100,
            // added by the server:
            monitoredItemId: 50
        });
        monitoredItem.setMonitoringMode(MonitoringMode.Reporting);


        var sample_value = 1;
        monitoredItem.on("samplingEvent",function(oldValue){
            sample_value ++;
            // read new value
            // check if different enough from old Value
            // if different enough : call recordValue
            this.recordValue({value:{ dataType: DataType.UInt32,value: sample_value }});

            monitoredItem.terminate();
            done();
        });

        this.clock.tick(200);
        sample_value.should.eql(2);

    });

    it("a MonitoredItem should not trigger any read event after terminate has been called",function(done){

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 100,
            // added by the server:
            monitoredItemId: 50
        });

        monitoredItem.setMonitoringMode(MonitoringMode.Reporting);

        var spy_samplingEventCall = sinon.spy();
        monitoredItem.on("samplingEvent",spy_samplingEventCall);

        this.clock.tick(2000);
        spy_samplingEventCall.callCount.should.be.greaterThan(6);
        var nbCalls = spy_samplingEventCall.callCount;

        monitoredItem.terminate();
        this.clock.tick(2000);
        spy_samplingEventCall.callCount.should.eql(nbCalls);

        done();
    });

    it("MonitoredItem#modify should cap queue size",function(done) {


        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 100,
            // added by the server:
            monitoredItemId: 50
        });

        var result ; // MonitoredItemModifyResult
        result =monitoredItem.modify(null,new MonitoringParameters({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 0xFFFFF
        }));

        result.revisedSamplingInterval.should.eql(100);
        result.revisedQueueSize.should.not.eql(0xFFFFF);

        done();
    });

    it("MonitoredItem#modify should cap samplingInterval",function(done) {

        var monitoredItem = new MonitoredItem({
            clientHandle: 1,
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 100,
            // added by the server:
            monitoredItemId: 50
        });

        var result ; // MonitoredItemModifyResult
        result =monitoredItem.modify(null,new MonitoringParameters({
            clientHandle: 1,
            samplingInterval: 0,
            discardOldest: true,
            queueSize: 10
        }));

        result.revisedSamplingInterval.should.not.eql(0);

        result =monitoredItem.modify(null,new MonitoringParameters({
            clientHandle: 1,
            samplingInterval: -1,
            discardOldest: true,
            queueSize: 10
        }));
        result.revisedSamplingInterval.should.not.eql(-1);
        done();
    });


});
