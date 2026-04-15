# Weather Usage

## Common commands

### Current weather

```bash
curl "wttr.in/London?format=3"
curl "wttr.in/London?0"
curl "wttr.in/New+York?format=3"
```

### Forecasts

```bash
curl "wttr.in/London"
curl "wttr.in/London?format=v2"
curl "wttr.in/London?1"
```

### Format options

```bash
curl "wttr.in/London?format=%l:+%c+%t+%w"
curl "wttr.in/London?format=j1"
curl "wttr.in/London.png"
```

## Format codes

- `%c` weather condition emoji
- `%t` temperature
- `%f` feels-like temperature
- `%w` wind
- `%h` humidity
- `%p` precipitation
- `%l` location

## Typical quick checks

```bash
curl -s "wttr.in/London?format=%l:+%c+%t+(feels+like+%f),+%w+wind,+%h+humidity"
curl -s "wttr.in/London?format=%l:+%c+%p"
curl "wttr.in/London?format=v2"
```
