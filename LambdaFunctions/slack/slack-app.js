var AWS = require('aws-sdk');
var db = new AWS.DynamoDB();
var https = require('https');
var url = require('url');
var querystring = require('querystring');

var clientId = process.env.SLACK_CLIENT_ID;
var clientSecret = process.env.SLACK_CLIENT_SECRET;
var apiUrl = 'https://slack.com/api';

var page_id = process.env.FACEBOOK_PAGE_ID;
var channel_id = process.env.SLACK_CHANNEL_ID;


exports.handler = function(event, context) {
    if (!event.queryStringParameters) {
        // No API Gateway proxy call, but rather direct Lambda invocation, handle payload differently
        switch (event.action) {
            case 'send_approval_message':
                SendApprovalMessage(channel_id, event.messageId, event.question, event.answer, event, context);
                break;
            default:
                context.done(null);
        }
    } else {
        var params = event.queryStringParameters;
        if (!params.action)
            context.done(null);
        switch (params.action) {
            case 'oauth':
                OAuth(params.code, event, context);
                break;
            case 'interactive_message':
                InteractiveMessage(event, context);
                break;
            case 'helloworld':
                HelloWorld(event, context);
                break;
            case 'last_messages':
                LastMessages(event, context);
                break;
            default:
                context.done(null, {
                    statusCode: '200'
                });
        }
    }
};

var InteractiveMessage = function(event, context) {
    var data = querystring.parse(event.body);
    var payload = JSON.parse(data.payload);
    console.log(payload);
    if (payload.actions) {
        var params = {
            TableName: 'facebook-messages',
            Key: {
                messageId: {
                    S: payload.callback_id
                }
            },
            UpdateExpression: "SET answered = :state",
            ExpressionAttributeValues: {

            },
            ReturnValues: "NONE"
        };
        if (payload.actions[0].value === 'approve') {
            console.log("Message with ID " + payload.callback_id + "approved");
            params.ExpressionAttributeValues = {
                ":state": {
                    S: "approved"
                }
            };
            db.updateItem(params, function(err, data) {
                if (err) context.done(err);
                else context.done(null, {
                    statusCode: 200,
                    body: payload.original_message.text + ':white_check_mark: Answer has been *approved*! '
                });
            });
        } else {
            console.log("Message with ID " + payload.callback_id + "rejected");
            params.ExpressionAttributeValues = {
                ":state": {
                    S: "rejected"
                }
            };
            db.updateItem(params, function(err, data) {
                if (err) context.done(err);
                else context.done(null, {
                    statusCode: 200,
                    body: payload.original_message.text + ':x: Answer has been *rejected*! '
                });
            });
        }
    }
};

var SendApprovalMessage = function(channel_id, messageId, question, answer, event, context) {
    var params = {
        AttributesToGet: [
            "incoming_webhook", "channel"
        ],
        TableName: 'slack-app-channels',
        Key: {
            "channel_id": {
                "S": channel_id
            }
        }
    };
    db.getItem(params, function(err, data) {
        if (err) {
            console.log(err);
            context.done(null, {
                statusCode: 500
            });
        }
        if (data.Item) {
            var message = {
                "text": "```Question: " + question + "\nProposed Answer: " + answer + "```",
                "attachments": [{
                    "text": "Do you approve of this answer?",
                    "fallback": "You are unable to approve the answer",
                    "color": "#3AA3E3",
                    "callback_id": messageId,
                    "attachment_type": "default",
                    "actions": [{
                        "name": "approve",
                        "text": "Approve",
                        "type": "button",
                        "value": "approve"
                    }, {
                        "name": "reject",
                        "text": "Reject",
                        "type": "button",
                        "style": "danger",
                        "value": "reject"
                    }]
                }]
            };
            SendChannelMessage(message, data.Item.incoming_webhook.S, event, context);
        }
    });
};

var SendChannelMessage = function(message, incoming_webhook, event, context) {
    var body = JSON.stringify(message);
    var options = url.parse(incoming_webhook);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    };

    var postReq = https.request(options, function(res) {
        var chunks = [];
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            return chunks.push(chunk);
        });
        res.on('end', function() {
            var body = chunks.join('');
            context.done(null, {
                statusCode: 200
            });
        });
        return res;
    });

    postReq.write(body);
    postReq.end();
};


// Ref: https://api.slack.com/docs/slack-button
var OAuth = function(code, event, context) {
    var params = '?client_id=' + clientId + '&client_secret=' + clientSecret + '&code=' + code;
    var post_req = https.get(apiUrl + '/oauth.access' + params, function(res) {
        res.setEncoding('utf8');
        res.on('data', function(data) {
            InsertChannelWebhookInDDB(JSON.parse(data), event, context);
        });
        res.on('error', function(e) {
            console.log('Error: ' + e.message);
            context.done(null, {
                statusCode: 500
            });
        });
    });
    // post the data
    post_req.end();
};

var InsertChannelWebhookInDDB = function(data, event, context) {
    console.log(data);
    var params = {
        Item: {
            channel_id: {
                S: data.incoming_webhook.channel_id
            },
            date: {
                S: new Date().toISOString()
            },
            channel: {
                S: data.incoming_webhook.channel
            },
            incoming_webhook: {
                S: data.incoming_webhook.url
            },
            configuration_url: {
                S: data.incoming_webhook.configuration_url
            }
        },
        TableName: 'slack-app-channels'
    };
    db.putItem(params, function(err, resp) {
        if (err) console.log(err);
        console.log("Successfully added Chatbot app to channel " + data.incoming_webhook.channel + " of team " + data.team_name);
        var url = 'https://' + data.team_name + '.slack.com/messages/' + data.incoming_webhook.channel.substr(1);
        context.done(null, {
            statusCode: 301,
            headers: {
                "Location": url
            }
        });
    });
};

var HelloWorld = function(event, context) {
    var data = querystring.parse(event.body);
    var message = {
        "text": "Hello re:invent 2016! Serverless rules :smile:",
    };
    SendChannelMessage(message, data.response_url, event, context);
};

var LastMessages = function(event, context) {
    var payload = querystring.parse(event.body);
    var params = {
        TableName: 'facebook-messages',
        KeyConditionExpression: 'page_id = :t1',
        IndexName: 'page_id-date-index',
        ExpressionAttributeValues: {
            ":t1": {
                "S": page_id
            }
        },
        Limit: 10,
        ScanIndexForward: false
    };
    db.query(params, function(err, data) {
        var output = "";
        for (var i = 0; i < data.Items.length; i++) {
            output = output + data.Items[i].message.S + "\n";
        }
        var message = {
            "text": "Here are the latest messages exchanged via Facebook",
            "attachments": [{
                "color": "#FF8C00",
                "text": output,
                "fallback": output
            }]
        };
        SendChannelMessage(message, payload.response_url, event, context);
    });
};
