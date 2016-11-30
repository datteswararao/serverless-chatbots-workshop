import nltk
nltk.data.path.append("/var/task/nltk-data/")
from nltk.corpus import stopwords
from nltk import word_tokenize
from nltk.stem import *

def handler(event, context):
    stop = set(stopwords.words('english'))
    punctuations = ['!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/', ':', ';', '<', '=', '>', '?', '@', '[', '\\', ']', '^', '_', '`', '{', '|', '}', '~']
    sentence_without_punctuation = [i for i in word_tokenize(event['sentence']) if i not in punctuations]
    sentence_without_stopwords = [i for i in sentence_without_punctuation if i not in stop]
    stemmer = SnowballStemmer("english")
    stemmed_sentence = [stemmer.stem(i) for i in sentence_without_stopwords]
    print stemmed_sentence
    return {
        'sentence'  :   event['sentence'],
        'stemmed_sentence'  : ' '.join(stemmed_sentence)
    }
