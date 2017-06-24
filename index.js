'use strict';
// Developed by Zac Patel on 6/20/17 with code contributions from Anil Patel
// This code written in part using the sample code provided by Amazon for constructing responses

// importing node packages
var request = require('request');
var _ = require('underscore');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();

// --------------- Helpers that build all of the responses -----------------------

// Standard Speechlet response (used for making non-image responses)
function buildSpeechletResponse(title, output, repromptText, shouldEndSession) {
    return {
        outputSpeech: {
            type: 'PlainText',
            text: output,
        },
        card: {
            type: 'Simple',
            title: `${title}`,
            content: `${output}`,
        },
        reprompt: {
            outputSpeech: {
                type: 'PlainText',
                text: repromptText,
            },
        },
        shouldEndSession,
    };
}

// Constructs a speechlet response that includes an image in the card (that appears in the Alexa companion app)
function buildPhotoSpeechletResponse(title, speechOutput, textOutput, sImageURL, lImageURL, repromptText, shouldEndSession) {
    return {
        outputSpeech: {
            type: 'PlainText',
            text: speechOutput,
        },
        card: {
            type: 'Standard',
            title: title,
            text: textOutput,
            image: {
                smallImageUrl: "https://images-na.ssl-images-amazon.com/images/G/01/mobile-apps/dex/ask-customskills/cards-image-card._TTH_.png",
                largeImageUrl: "https://images-na.ssl-images-amazon.com/images/G/01/mobile-apps/dex/ask-customskills/cards-image-card._TTH_.png",
            }
        },
        reprompt: {
            outputSpeech: {
                type: 'PlainText',
                text: repromptText,
            },
        },
        shouldEndSession,
    };
}

// Combines the session attributes and speechlet response, and sends them back to Alexa to be presented to the user
function buildResponse(sessionAttributes, speechletResponse) {
    return {
        version: '1.0',
        sessionAttributes,
        response: speechletResponse,
    };
}

// --------------- Functions that control the skill's behavior -----------------------

function getWelcomeResponse(callback) {
    // If we wanted to initialize the session to have some attributes we could add those here.
    const sessionAttributes = {};
    const cardTitle = 'Welcome';
    const speechOutput = 'Welcome to Catso. Ask me for some photos.';
    // If the user either does not reply to the welcome message or says something that is not
    // understood, they will be prompted again with this text.
    const repromptText = 'Would you like a cat photo?';
    const shouldEndSession = false;

    callback(sessionAttributes,
        buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

function handleSessionEndRequest(callback) {
    const cardTitle = 'Session Ended';
    const speechOutput = ''; // No speech necessary when the skill ends
    // Setting this to true ends the session and exits the skill.
    const shouldEndSession = true;

    callback({}, buildSpeechletResponse(cardTitle, speechOutput, null, shouldEndSession));
}

// -------------- Main Intent Code --------------
// Broad-scale event handler called from onIntent. This method handles the entire process of querying photos,
// processing them, and sending them to the user's device in the speechlet response 
function getCatPhotosHandler(intent, session, callback) {
    // using let instead of var here because we don't need these values outside this scope

    // setting standard vars for output into 
    let cardTitle = 'Cat Photos';
    let repromptText = '';
    let sessionAttributes = {};
    let shouldEndSession = true;
    let speechOutput = 'I have sent a cat photo to your phone. Check the Alexa app.';
    let textOutput = 'Here is a cat photo:';

    // grabbing the image URLs from reddit
    getRedditImages('cats', function(error, imgData) {
        if (error) {
            console.error(`Errored when attemping to get images : ${error.message}`);
            // TODO: add speechlet with error message 
        } else {
            callback(sessionAttributes,
                buildPhotoSpeechletResponse(cardTitle, speechOutput, textOutput, imgData.small, imgData.large, repromptText, shouldEndSession));
        }
    });
}

// --------------- Events -----------------------

/**
 * Called when the session starts.
 */
function onSessionStarted(sessionStartedRequest, session) {
    console.log(`onSessionStarted requestId=${sessionStartedRequest.requestId}, sessionId=${session.sessionId}`);
}

/**
 * Called when the user launches the skill without specifying what they want.
 */
function onLaunch(launchRequest, session, callback) {
    console.log(`onLaunch requestId=${launchRequest.requestId}, sessionId=${session.sessionId}`);

    // Dispatch to your skill's launch.
    getWelcomeResponse(callback);
}

/**
 * Called when the user specifies an intent for this skill.
 */
function onIntent(intentRequest, session, callback) {
    console.log(`onIntent requestId=${intentRequest.requestId}, sessionId=${session.sessionId}`);

    const intent = intentRequest.intent;
    const intentName = intentRequest.intent.name;

    // Dispatch to your skill's intent handlers
    if (intentName === 'GETCATPHOTOINTENT') {
        //TODO: change this line
        getCatPhotosHandler(intent, session, callback);
    } else if (intentName === 'AMAZON.HelpIntent') {
        getWelcomeResponse(callback);
    } else if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
        handleSessionEndRequest(callback);
    } else {
        throw new Error('Invalid intent');
    }
}

/**
 * Called when the user ends the session.
 * Is not called when the skill returns shouldEndSession=true.
 */
function onSessionEnded(sessionEndedRequest, session) {
    console.log(`onSessionEnded requestId=${sessionEndedRequest.requestId}, sessionId=${session.sessionId}`);
    // Add cleanup logic here
}


// --------------- Main handler -----------------------

// Route the incoming request based on type (LaunchRequest, IntentRequest,
// etc.) The JSON body of the request is provided in the event parameter.
exports.handler = (event, context, callback) => {
    try {
        console.log(`event.session.application.applicationId=${event.session.application.applicationId}`);

        /**
         * Uncomment this if statement and populate with your skill's application ID to
         * prevent someone else from configuring a skill that sends requests to this function.
         */
        
        if (event.session.application.applicationId !== 'amzn1.ask.skill.b58f87e5-4321-40fe-ac0d-0c5a5236a405') {
             callback('Invalid Application ID');
        }

        if (event.session.new) {
            onSessionStarted({ requestId: event.request.requestId }, event.session);
        }

        if (event.request.type === 'LaunchRequest') {
            onLaunch(event.request,
                event.session,
                (sessionAttributes, speechletResponse) => {
                    callback(null, buildResponse(sessionAttributes, speechletResponse));
                });
        } else if (event.request.type === 'IntentRequest') {
            onIntent(event.request,
                event.session,
                (sessionAttributes, speechletResponse) => {
                    callback(null, buildResponse(sessionAttributes, speechletResponse));
                });
        } else if (event.request.type === 'SessionEndedRequest') {
            onSessionEnded(event.request, event.session);
            callback();
        }
    } catch (err) {
        callback(err);
    }
};

// Takes in the name of asubreddit, and finds the location of the preview images of the top post
// preview images are then saved to the .small and .large fields of the imgData param
// note, this function does not specifically error trap for bad subreddit names
var getRedditImages = function(subreddit, callback) {
    // First get an access token from Reddit using this OAuth2 workflow
    // https://github.com/reddit/reddit/wiki/OAuth2#application-only-oauth
    var options = {
        // Note: This is clientId:clientSecret@host
        // Saving our request URL to an environment variable for safety reasons
        url: process.env.REDDITACCESSTOKENURL,
        method: 'POST',
        headers: {
            'User-Agent': 'request'
        },
        body: 'grant_type=client_credentials&username=&password='
    };

    request(options, function (error, response, body) {
        if (error) {
            console.error('Could not authenticate: ' + error.message);
            callback(error);
        } else {
            var bodyAsJson = JSON.parse(body);
            // We now have an access token
            var access_token = bodyAsJson.access_token;
            console.log('access token is: ' + access_token);
            var data;
            var options = {
                method: 'GET',
                url: 'https://oauth.reddit.com/r/' + subreddit + '/top/.json',
                qs: {
                    count: 0
                },
                headers: {
                    'Authorization': 'bearer ' + access_token,
                    'User-Agent': 'agent'
                },
            };
            request(options, function (error, response, body) {
                if (error) {
                    console.error('Failed to get top posts: ' + error.message);
                    callback(error);
                } else {
                    data = JSON.parse(body);
                    // Printing out the url of the image
                    // Get the list of previews for the first image, go through the resolutions and pick appropriate sizes
                    var previews = data.data.children[0].data.preview.images[0];
                    var smallPreview = _.find(previews.resolutions, function(item) { return item.width >= 720 || item.height >= 480; });
                    var largePreview = _.find(previews.resolutions, function(item) { return item.width >= 1200 || item.height >= 800; });
                    var imgData = {}; // return object

                    // If none of the images met the small criteria, choose the first one
                    if (!smallPreview) {
                        smallPreview = _.last(previews.resolutions);
                    }
                    // If none of the images met the large criteria, choose the last one
                    if (!largePreview) {
                        largePreview = _.last(previews.resolutions);
                    }

                    if (smallPreview) {
                        var smallPreviewDecoded = smallPreview.url.replace(/&amp;/g, "&");
                        imgData.small = smallPreviewDecoded;
                    }

                    if (largePreview) {
                        var largePreviewDecoded = largePreview.url.replace(/&amp;/g, "&");
                        imgData.large = largePreviewDecoded;
                    }

                    callback(undefined, imgData);
                }
            });
        }
    });


};




// Amazon sample code for reference
/* Sets the color in the session and prepares the speech to reply to the user. */
 
function setColorInSession(intent, session, callback) {
    const cardTitle = intent.name;
    const favoriteColorSlot = intent.slots.Color;
    let repromptText = '';
    let sessionAttributes = {};
    const shouldEndSession = false;
    let speechOutput = '';

    if (favoriteColorSlot) {
        const favoriteColor = favoriteColorSlot.value;
        sessionAttributes = createFavoriteColorAttributes(favoriteColor);
        speechOutput = `I now know your favorite color is ${favoriteColor}. You can ask me ` +
            "your favorite color by saying, what's my favorite color?";
        repromptText = "You can ask me your favorite color by saying, what's my favorite color?";
    } else {
        speechOutput = "I'm not sure what your favorite color is. Please try again.";
        repromptText = "I'm not sure what your favorite color is. You can tell me your " +
            'favorite color by saying, my favorite color is red';
    }

    callback(sessionAttributes,
         buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

/**/
function getColorFromSession(intent, session, callback) {
    let favoriteColor;
    const repromptText = null;
    const sessionAttributes = {};
    let shouldEndSession = false;
    let speechOutput = '';

    if (session.attributes) {
        favoriteColor = session.attributes.favoriteColor;
    }

    if (favoriteColor) {
        speechOutput = `Your favorite color is ${favoriteColor}. Goodbye.`;
        shouldEndSession = true;
    } else {
        speechOutput = "I'm not sure what your favorite color is, you can say, my favorite color " +
            ' is red';
    }

    // Setting repromptText to null signifies that we do not want to reprompt the user.
    // If the user does not respond or says something that is not understood, the session
    // will end.
    callback(sessionAttributes,
         buildSpeechletResponse(intent.name, speechOutput, repromptText, shouldEndSession));
}
