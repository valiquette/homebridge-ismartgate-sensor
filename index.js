let   axios = require("axios")
      //mdns = require('mdns-js'); ///"mdns-js": "^1.0.3",

var	  API,
	  Accessory,
	  Characteristic,
	  Service;

module.exports = function(homebridge) {
	API = homebridge;
    Accessory = homebridge.hap.Accessory;
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;

    homebridge.registerAccessory("homebridge-ismartgate-sensor", "iSmartGate", iSmartGate);
};

function iSmartGate(log, config) {
    this.log = log;
    this.name = config["name"] || "iSmartGate Temperature";
    this.username = config["username"];
    this.password = config["password"];
    this.hostname = config["hostname"];
    this.response = null;
    this.cookie = null

    this.CurrentTemperature = null;
    this.BatteryLevel = null;
}

iSmartGate.prototype = {

    identify: function(callback) {
        this.log.info("identify");
        callback();
    },

	getServices: function() {

		// Temperature Sensor service
		this.TemperatureSensor = new Service.TemperatureSensor(this.name);

		// Battery service
        this.BatteryService = new Service.Battery(this.name);

		// Accessory Information service
        this.AccessoryInformation = new Service.AccessoryInformation();
        this.AccessoryInformation
            .setCharacteristic(Characteristic.Name, this.name)
            .setCharacteristic(Characteristic.Manufacturer, "iSmartGate")
            .setCharacteristic(Characteristic.Model, "Temperature")
            .setCharacteristic(Characteristic.FirmwareRevision, "1.4.2")
            .setCharacteristic(Characteristic.SerialNumber, this.username);

/*
		// Start searching for the iSmartGate using mDNS
		var browser = mdns.createBrowser("_hap._tcp");
		browser.on('ready', function() { browser.discover(); });
		browser.on('update', function(data) {
			if(data['txt']) {
				data['txt'].forEach(txt => {
					txt = txt.split("=");
					if(txt[0] == "md" && txt[1] == "iSmartGate" && data.addresses[0] != this.hostname) {
						// Set the new hostname obtained from mDNS
						this.hostname = data.addresses[0];
						this.log.info("Found an iSmartGate at", this.hostname);

						// Login to the iSmartGate for the first time and refresh
						setTimeout(function() {
							this._login();
						}.bind(this), 2500);
					}
				});
			}
		}.bind(this));
*/

        // Login to the iSmartGate for the first time and refresh
        setTimeout(function() {
            this.response=this._login();
        }.bind(this), 2500);

        setTimeout(function() {
            this._refresh();
        }.bind(this), 5000);

		// Set a timer to refresh the data every 10 minutes
		setInterval(function() {
			this._refresh();
		}.bind(this), 600000);

		// Set a timer to refresh the login token every 3 hours
		setInterval(function() {
			this.response=this._login();
		}.bind(this), 10800000);

		// Return the Accessory
        return [
			this.AccessoryInformation,
            this.TemperatureSensor,
            this.BatteryService
        ];

    },

	_login: async function() {
		try {
			this.log.info('Retrieving token')
			let response = await axios({
                withCredentials: true,
				method: 'post',
				url: `http://${this.hostname}/index.php`,
				headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
					'Accept-Encoding': 'gzip,deflate,compress',
				},
                data: {
                    "MIME Type": "application/x-www-form-urlencoded",
                    "login": this.username,
                    "pass": this.password,
                    "send-login": "Sign in"
                },
				responseType: 'text'
			}).catch(err => {
				this.log.debug(JSON.stringify(err, null, 2))
				this.log.error('Error signing in and getting token %s', err.message)
				if (err.response) { this.log.warn(JSON.stringify(err.response.data, null, 2))}
				return err.response
			})
			if (response.status == 200) {
                this.log.info("Logged into iSmartGate succesfully");
				this.log.debug('signin response', response.headers)
                this.cookie=response.headers['set-cookie']
                return response
			}
		} catch (err) { this.log.error('Error retrieving token \n%s', err)}
	},

    _refresh: async function() {
		try {
            this.log.debug("Start refreshing temperature & battery");
			let response = await axios({
                withCredentials: true,
				method: 'get',
				url: `http://${this.hostname}/isg/temperature.php`,
                headers: {
					'Cookie': this.cookie
				},
                params: {
                    door: 1
                },
				responseType: 'json'
			}).catch(err => {
				this.log.debug(JSON.stringify(err, null, 2))
				this.log.error('Error fetching temperature & battery %s', err.message)
				if (err.response) { this.log.warn(JSON.stringify(err.response.data, null, 2))}
				return err.response
			})
			if (response.status == 200 && Array.isArray(response.data)) {
                this.log.debug("Obtained status.", response.data);

                // Find the CurrentTemperature
                this.CurrentTemperature = response.data[0] / 1000;

                // Find the BatteryLevel
                switch (response.data[1]) {
                    case "full":    this.BatteryLevel = 100;    break;
                    case "80":      this.BatteryLevel = 80;     break;
                    case "60":      this.BatteryLevel = 60;     break;
                    case "40":      this.BatteryLevel = 40;     break;
                    case "20":      this.BatteryLevel = 20;     break;
                    case "low":     this.BatteryLevel = 10;     break;

                    default:
                        this.log.warn("Unexpected BatteryLevel detected.", response.data);
                        this.BatteryLevel = 0;
                    break;
                }

				// Set the Current Temperature
                this.TemperatureSensor.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.CurrentTemperature);

                // Set the Battery Level
                this.BatteryService.setCharacteristic(Characteristic.BatteryLevel, this.BatteryLevel);

                // Set the Status Low Battery
                if(this.BatteryLevel <= 10) {this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);}
                else {this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);}
                return response
			}
            else {
				if(response.data == "Restricted Access") {this.log.error("Restricted Access", response.data);}
					else if(response.data == "Login Token Expired") {this.log.error("Login Token Expired", response.data);}
					else {
                        this.log.error("Could not connect.", "Check http://" + this.hostname + " to make sure the device is still reachable & no captcha is showing.");
                        this.log.error(response.data);}
                    }

		} catch (err) { this.log.error('Error retrieving temperature & battery \n%s', err)}
    },

    _getValue: function(CharacteristicName, callback) {
        this.log.debug("GET", CharacteristicName);
		callback(null);
    },

    _setValue: function(CharacteristicName, value, callback) {
        this.log.debug("SET", CharacteristicName, value);
        callback();
    }

};
