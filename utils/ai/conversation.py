from collections import defaultdict, deque

conversations = defaultdict(lambda: deque(maxlen=4))