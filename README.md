# carnet-logger

Simple logger to query the charging status of electric cars of Volkswagen (ID.3, ID.4).

## Howto

Install the logger for example under `/etc/scripts` (as superuser):

    cd /opt
    git clone https://github.com/0x253/carnet-logger.git
    npm install

Add the following line to your crontab file:

    55  *    * * *   root    /opt/carnet-logger/carnet-logger.js --email email --password yourpassword --fin fin

The logger will query fuel state of your electric vehicle and the expected drive distance.

To trigger custom actions after the response has been received and parsed, adapt the
function `onDataReceived` to your needs.
