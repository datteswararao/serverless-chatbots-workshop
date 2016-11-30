var AWS = require('aws-sdk');
var http = require('https');
var md5 = require('md5');
var path = require('path');
var async = require('async');


var esDomain = {
    region: process.env.AWS_REGION,
    endpoint: process.env.ES_ENDPOINT
};
var endpoint = new AWS.Endpoint(esDomain.endpoint);
var creds = new AWS.EnvironmentCredentials('AWS');


// all question words are stemmed with English snowball stemmer
var qa = [{
    question: "hate bad horribl unhappi",
    answer: "We are sorry to hear you are unhappy with our service, one of our service representative will get back in touch with you shortly."
}, {
    question: "love good magnifici",
    answer: "We are happy to hear this, thank you! Let the unicorns bring you everywhere :)"
}, {
    question: "hello hi hey howdy",
    answer: "Hey there, I'm an automated Chatbot of WildRydes, how can I help you today?"
}, {
    question: "locat status unicorn where",
    answer: "You can find your unicorn location status in the WildRydes app, can I suggest you look up the status of your unicorn in the Status tab of the app?"
}, {
    question: "book registr regist reserv",
    answer: "If you are trying to reserve a unicorn ride we advise you to download our WildRydes mobile app!"
}, {
    question: "recruit the unicorn trustworthi",
    answer: "Our unicorns are recruited from only the most humane and highest standard unicorn farms. Our unicorns are grass-fed, free range creatures raised on vegan, non-GMO diets. These unicorns are also completely safe because unicorns have infallible morality and judgment."
}, {
    question: "cost price",
    answer: "Since Wild Rydes is a marketplace for flight-based transportation, the price you pay is based on factors such as distance and availability of unicorns. You set the maximum price you’re willing to pay for a given ryde and then Wild Rydes matches you with a unicorn that’s willing to accept your price."
}, {
    question: "complain complaint",
    answer: "Wild Rydes is a customer obsessed company. We value each customer and want to ensure a positive experience. Therefore, we’ve staffed our customer service team with serverless chatbots that are available 24/7 to assist you."
}, {
    question: "intern countri",
    answer: "Yes, you can use Wild Rydes in most countries except for Antarctica, Cuba, Sudan, Iran, North Korea, Syria and any other country designated by the United States Treasury's Office of Foreign Assets Control."
}, {
    question: "share rout inform",
    answer: "During your ryde, you can share your route and ETA with someone else using the Wild Rydes app. Simply tap the “Share Route” button and select a contact. Soon, they’ll be able to watch the status of your ryde."
}, {
    question: "rate star",
    answer: "After your ryde completes, you have the option to rate your unicorn on the app. Our unicorns are customer obsessed and strive for 5 star ratings. Your feedback helps us improve our service!"
}, {
    question: "servic fee",
    answer: "The service fee is a fixed charge added to every ryde. This helps us pay for our on-going maintenance and operating costs required to run the service and tend to our unicorn herd."
}, {
    question: "fast fastest top speed mph kph",
    answer: "Our unicorns are not bound by the laws of physics and are able to travel at 2c."
}, {
    question: "eat food feed healthi hungri",
    answer: "Unicorns only eat the best that nature has to offer. Blue milk, lembas bread, rainbows, and that cheesecake from that episode of Friends."
}];



exports.handler = function(event, context) {
    async.eachLimit(qa, 5, function(doc, callback) {
        var hash = md5(doc.question);
        console.log("Question: " + doc.question + " Hash: " + hash);
        PostToES(hash, JSON.stringify(doc), callback);
    }, function(err) {
        if (err) {
            context.done(err);
        } else {
            context.done(null, "Knowledge Base loaded successfully");
        }
    });
};

var PostToES = function(id, doc, callback) {
    var req = new AWS.HttpRequest(endpoint);
    req.method = 'POST';
    req.path = path.join('/', 'knowledgebase', 'qa', id);
    req.region = esDomain.region;
    req.headers['presigned-expires'] = false;
    req.headers.Host = endpoint.host;
    req.body = doc;

    var signer = new AWS.Signers.V4(req, 'es');
    signer.addAuthorization(creds, new Date());

    var send = new AWS.NodeHttpClient();
    send.handleRequest(req, null, function(httpResp) {
        var respBody = '';
        httpResp.on('data', function(chunk) {
            respBody += chunk;
        });
        httpResp.on('end', function(chunk) {
            callback(null);
        });
    }, function(err) {
        console.log('Error: ' + err);
        callback(err);
    });
};
