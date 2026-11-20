"""Emit one signed demo reading. The device seed stays with the simulator."""
import argparse
import json
import os
import time

from app.services.sensor import sign_reading


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sensor", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--temperature", required=True, type=float)
    parser.add_argument("--sequence", required=True, type=int)
    args = parser.parse_args()
    seed = bytes.fromhex(os.environ["SENSOR_DEMO_SEED_HEX"])
    reading = sign_reading(seed, args.sensor, args.token, args.temperature, int(time.time()), args.sequence)
    print(json.dumps(reading))


if __name__ == "__main__":
    main()
