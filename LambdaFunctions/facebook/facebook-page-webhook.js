var AWS = require('aws-sdk');
var db = new AWS.DynamoDB();
var http = require('https');
var page_id = process.env.FACEBOOK_PAGE_ID;
var page_access_token = process.env.FACEBOOK_ACCESS_TOKEN;

exports.handler = function(event, context) {
    if (event['httpMethod'] == "GET") {
        authenticateFacebookWebhook(event, context);
    } else {
        var body = JSON.parse(event.body);
        if (body.entry) {
            processEvents(body, context);
        } else {
            context.done(null, {
                statusCode: 200
            })
        }
    }
};

var processEvents = function(event, context) {
    event.entry.forEach(function(entry) {
        // incoming event is a Facebook Messenger message
        if (entry.messaging) {
            console.log(entry.messaging);
            entry.messaging.forEach(function(message) {
                var sender_id = message.sender.id;
                if (sender_id === page_id) return;
                storeMessageInDDB(message, event, context);
            });
        }
    });
};

var authenticateFacebookWebhook = function(event, context) {
    // return the hub.challenge to Facebook to register the webhook to Facebook
    if (event.queryStringParameters['hub.mode'] == 'subscribe' && event.queryStringParameters['hub.verify_token'] == 'reinvent-workshop') {
        console.log("Facebook Webhook authentication done");
        context.done(null, {
            statusCode: 200,
            body: event.queryStringParameters['hub.challenge']
        });
    }
};

var storeMessageInDDB = function(message, event, context) {
    var params = {
        Item: {
            messageId: {
                S: message.message.mid
            },
            date: {
                S: new Date().toISOString()
            },
            senderId: {
                S: message.sender.id
            },
            message: {
                S: message.message.text
            },
            page_id: {
                S: page_id
            }
        },
        TableName: 'facebook-messages'
    };
    db.putItem(params, function(err, data) {
        if (err) console.log(err);
        context.done(null, {
            statusCode: 200
        });
    });
};
