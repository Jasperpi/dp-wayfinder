Build the best campus wayfinder you can for Dos Pueblos High School (Goleta, CA), in this folder.

## Who it is for

Someone standing on campus with a phone who does not know where anything is: a parent at Back to School Night, a substitute teacher, a visiting team, a new student. They want to type "Ms. Anderson", "H-27", "staff lounge" or "pool" and be walked there. Many are on one bar of signal, outdoors, at night, and are not technical.

A wayfinder for this campus already exists at https://dphsleadership.com/find. You may look at it. Your job is to build a better one, and I will compare the two side by side on a phone. Do not copy it; decide for yourself what a great one looks like.

## What you have

Everything is in `data/`. This is the real campus.

- `campus-map.png`: the school's official campus map. Buildings, fields, courts and the pool are drawn as closed black outlines.
- `campus.json`: the map's 1000x875 coordinate space, the georeference (map point to real latitude and longitude, and which way north is), 106 classrooms with positions, 17 landmarks, 43 named spots (offices, restrooms, staff lounge and so on) with search keywords, the building names, and four places visitors usually start from.
- `walkable.json`: a grid of where a person can physically walk, with fences and locked areas already corrected by someone who walked the campus, plus a second grid marking the courtyards people actually use.
- `teachers.json`: 111 teachers with their room, department and class each period.
- `bell-schedule.json`: the bell schedule. Times are minutes after midnight.

Read each file's own notes before you design anything. Google Maps has no paths inside the school fence, so you cannot hand routing to a maps service; the walk has to be solved here.

## What it must do

1. Search that forgives people. Teacher names, room numbers typed any way ("h27", "H 27", "H-27"), places, departments and courses all work, with typos.
2. A walking route from where the person is to where they are going, drawn on a map of the campus. The route never crosses a building, a field, a court or a fence, and it follows the way a person would really walk.
3. Where they are can come from the phone's location, from tapping the map, or from one of the starting points. Location must be optional: plenty of phones will refuse it, and nobody should ever be stuck.
4. Distance, walking time and turn-by-turn steps in plain words that use landmarks ("past the Library on your left"), never compass directions. Left and right must be correct for a person walking the route in the real world.
5. With location on, the map follows the walker: a dot where they are, the route updating as they move, and the option to turn the map to face the way they are facing.
6. It draws the campus itself, clearly and attractively, with names that stay readable as you zoom. Showing the scanned PNG under a line is not good enough.
7. Phone first. Pan, pinch zoom, large touch targets, readable outdoors, light and dark.
8. It keeps working with no signal once it has loaded.
9. A link to one destination can be shared, and opens with that place already picked.

## Rules

- Location stays on the device. No analytics, no third-party requests that carry anything about the user.
- No accounts and no server-side database. It should deploy as a static site.
- Use only the data in `data/`. Do not invent rooms, teachers or places.
- Choose your own stack. Keep dependencies few and say why you chose each one.

## Proof

Write automated tests and run them. At minimum:

- every classroom, landmark and spot can be reached from every starting point;
- no route passes through a cell that is not walkable;
- the georeference round-trips (map point to latitude/longitude and back);
- left and right in the written steps agree with real-world geometry;
- search finds the right result for a list of messy queries you write yourself.

Then open it in a real browser at phone size, take screenshots of a search, a route and the turn-by-turn steps, look at them, and fix what looks wrong.

## How to work

1. Read the data and look at the map image. Tell me what you found, including anything in the data that looks wrong or surprising.
2. Show me a short plan and the design direction before you write code.
3. Build it.
4. Finish with: how to run it, what the tests cover and their results, what you are unsure about, and the three things you would do next.

Report results honestly. If a test fails or something does not work, say so.
