// Prints a fresh VAPID key pair for the env file. Run once per environment.
import process from 'node:process';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`);
