
from nltk.sentiment.vader import SentimentIntensityAnalyzer
sid = SentimentIntensityAnalyzer()

def handler(event, context):
    sentiment = sid.polarity_scores(event['sentence'])
    print('{0}: {1}, '.format(event['sentence'], sentiment))
    return {
        'sentence'  : event['sentence'],
        'sentiment' : sentiment
    }
