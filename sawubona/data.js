// Sawubona — shared data + brief-building logic.
// Loaded by both the app page (index.html) and the service worker (sw.js),
// so it must be plain script: no imports, no DOM access, no window-only APIs.

// ---------------------------------------------------------------------------
// Zulu word of the day (rotates daily; c = dental click "tut", q = palatal
// click "cork pop", x = lateral click "gee-up a horse")
// ---------------------------------------------------------------------------
const ZULU_WORDS = [
  { w: "Sawubona", say: "sah-woo-BOH-nah", m: "Hello (to one person) — literally \"I see you\"", eg: "Sawubona, unjani? — Hello, how are you?" },
  { w: "Yebo", say: "YEH-boh", m: "Yes (also used as a casual greeting reply)", eg: "Yebo, ngiyavuma. — Yes, I agree." },
  { w: "Ngiyabonga", say: "ngee-yah-BON-gah", m: "Thank you", eg: "Ngiyabonga kakhulu! — Thank you very much!" },
  { w: "Unjani?", say: "oon-JAH-nee", m: "How are you? (to one person)", eg: "Sawubona! Unjani namhlanje? — Hello! How are you today?" },
  { w: "Ngiyaphila", say: "ngee-yah-PEE-lah", m: "I am well / I'm fine", eg: "Ngiyaphila, ngiyabonga. — I'm well, thank you." },
  { w: "Hamba kahle", say: "HAHM-bah GAH-shle", m: "Go well — said to the person who is leaving", eg: "Hamba kahle, mngane wami! — Go well, my friend!" },
  { w: "Sala kahle", say: "SAH-lah GAH-shle", m: "Stay well — said when you are the one leaving", eg: "Sala kahle, sizobonana kusasa. — Stay well, see you tomorrow." },
  { w: "Ubuntu", say: "oo-BOON-too", m: "Humanity, kindness — \"I am because we are\"", eg: "Umuntu ngumuntu ngabantu. — A person is a person through other people." },
  { w: "Amanzi", say: "ah-MAHN-zee", m: "Water", eg: "Ngicela amanzi. — May I have some water, please." },
  { w: "Ukudla", say: "oo-GOO-dlah", m: "Food", eg: "Ukudla kumnandi! — The food is delicious!" },
  { w: "Umakhalekhukhwini", say: "oo-mah-kah-leh-koo-KWEE-nee", m: "Cellphone — literally \"the thing that cries in the pocket\"", eg: "Ungawukhohlwa umakhalekhukhwini wakho. — Don't forget your cellphone." },
  { w: "Umngane", say: "oom-NGAH-neh", m: "Friend", eg: "Ungumngane wami omkhulu. — You are my great friend." },
  { w: "Uthando", say: "oo-TAHN-doh", m: "Love", eg: "Uthando lunqoba konke. — Love conquers all." },
  { w: "Imali", say: "ee-MAH-lee", m: "Money", eg: "Imali ayitheli emithini. — Money doesn't grow on trees." },
  { w: "Umsebenzi", say: "oom-seh-BEN-zee", m: "Work, a job", eg: "Nginomsebenzi omusha. — I have a new job." },
  { w: "Ikhaya", say: "ee-KAH-yah", m: "Home", eg: "Ngiya ekhaya. — I am going home." },
  { w: "Indlu", say: "een-DLOO", m: "House", eg: "Indlu enhle! — What a beautiful house!" },
  { w: "Ilanga", say: "ee-LAHN-gah", m: "Sun (also means \"day\")", eg: "Ilanga liyashisa namhlanje. — The sun is hot today." },
  { w: "Inyanga", say: "een-YAHN-gah", m: "Moon (also means \"month\")", eg: "Inyanga iyakhanya ebusuku. — The moon shines at night." },
  { w: "Inkanyezi", say: "een-kah-NYEH-zee", m: "Star", eg: "Bheka izinkanyezi! — Look at the stars!" },
  { w: "Imvula", say: "eem-VOO-lah", m: "Rain", eg: "Imvula iyana. — It is raining." },
  { w: "Umoya", say: "oo-MOH-yah", m: "Wind, air — also spirit", eg: "Umoya uyavunguza. — The wind is blowing." },
  { w: "Umlilo", say: "oom-LEE-loh", m: "Fire", eg: "Basa umlilo. — Light the fire." },
  { w: "Intaba", say: "een-TAH-bah", m: "Mountain", eg: "Intaba ende kakhulu. — A very tall mountain." },
  { w: "Ulwandle", say: "ool-WAHN-dleh", m: "The sea, ocean", eg: "Siya olwandle ngeSonto. — We're going to the sea on Sunday." },
  { w: "Umfula", say: "oom-FOO-lah", m: "River", eg: "Umfula ugcwele amanzi. — The river is full of water." },
  { w: "Isihlahla", say: "ee-see-SHLAH-shlah", m: "Tree", eg: "Isihlahla esikhulu. — A big tree." },
  { w: "Imbali", say: "eem-BAH-lee", m: "Flower", eg: "Imbali enhle. — A pretty flower." },
  { w: "Inja", say: "EEN-jah", m: "Dog", eg: "Inja yami ithanda ukudlala. — My dog loves to play." },
  { w: "Ikati", say: "ee-KAH-tee", m: "Cat", eg: "Ikati lilele elangeni. — The cat is sleeping in the sun." },
  { w: "Inkomo", say: "een-KOH-moh", m: "Cow", eg: "Izinkomo zidla utshani. — The cows are eating grass." },
  { w: "Ihhashi", say: "ee-HAH-shee", m: "Horse", eg: "Ihhashi eliphuma phambili. — The horse that runs in front (the winner)." },
  { w: "Inyoni", say: "een-YOH-nee", m: "Bird", eg: "Inyoni iyacula. — The bird is singing." },
  { w: "Imbuzi", say: "eem-BOO-zee", m: "Goat", eg: "Imbuzi idla yonke into. — A goat eats everything." },
  { w: "Umama", say: "oo-MAH-mah", m: "Mother, mom", eg: "Umama uyapheka. — Mom is cooking." },
  { w: "Ubaba", say: "oo-BAH-bah", m: "Father, dad", eg: "Ubaba usemsebenzini. — Dad is at work." },
  { w: "Ugogo", say: "oo-GOH-goh", m: "Grandmother", eg: "Ugogo uxoxa izindaba. — Granny tells stories." },
  { w: "Umkhulu", say: "oom-KOO-loo", m: "Grandfather", eg: "Umkhulu uhlakaniphile. — Grandfather is wise." },
  { w: "Ingane", say: "een-GAH-neh", m: "Child", eg: "Ingane iyahleka. — The child is laughing." },
  { w: "Isinkwa", say: "ee-SEEN-kwah", m: "Bread", eg: "Ngicela isinkwa nebhotela. — Bread and butter, please." },
  { w: "Ubisi", say: "oo-BEE-see", m: "Milk", eg: "Itiye nobisi. — Tea with milk." },
  { w: "Itiye", say: "ee-TEE-yeh", m: "Tea", eg: "Ngicela itiye. — Tea, please." },
  { w: "Ikhofi", say: "ee-KOH-fee", m: "Coffee", eg: "Ikhofi ekuseni! — Coffee in the morning!" },
  { w: "Inyama", say: "een-YAH-mah", m: "Meat", eg: "Inyama eyosiwe — braaied meat. Yum." },
  { w: "Namhlanje", say: "nahm-SHLAHN-jeh", m: "Today", eg: "Namhlanje usuku oluhle. — Today is a beautiful day." },
  { w: "Kusasa", say: "goo-SAH-sah", m: "Tomorrow", eg: "Sizobonana kusasa. — We'll see each other tomorrow." },
  { w: "Izolo", say: "ee-ZOH-loh", m: "Yesterday", eg: "Ngambona izolo. — I saw him/her yesterday." },
  { w: "Manje", say: "MAHN-jeh", m: "Now", eg: "Woza manje! — Come now!" },
  { w: "Ekuseni", say: "eh-goo-SEH-nee", m: "In the morning", eg: "Ngivuka ekuseni. — I wake up in the morning." },
  { w: "Ntambama", say: "n-tahm-BAH-mah", m: "In the afternoon", eg: "Sizodlala ntambama. — We'll play in the afternoon." },
  { w: "Ebusuku", say: "eh-boo-SOO-goo", m: "At night", eg: "Izinkanyezi zivela ebusuku. — The stars come out at night." },
  { w: "Isikhathi", say: "ee-see-KAH-tee", m: "Time", eg: "Isikhathi yimali. — Time is money." },
  { w: "Usuku", say: "oo-SOO-goo", m: "Day", eg: "Usuku oluhle! — Have a nice day!" },
  { w: "Iviki", say: "ee-VEE-kee", m: "Week", eg: "Iviki elizayo — next week." },
  { w: "Unyaka", say: "oon-YAH-gah", m: "Year", eg: "Unyaka omusha omuhle! — Happy new year!" },
  { w: "Phuza", say: "POO-zah", m: "Drink (verb)", eg: "Phuza amanzi amaningi. — Drink lots of water." },
  { w: "Dlala", say: "DLAH-lah", m: "Play (verb)", eg: "Izingane ziyadlala. — The children are playing." },
  { w: "Funda", say: "FOON-dah", m: "Learn / read (verb)", eg: "Ngifunda isiZulu! — I am learning Zulu!" },
  { w: "Bhala", say: "BAH-lah", m: "Write (verb)", eg: "Bhala igama lakho. — Write your name." },
  { w: "Cula", say: "(click)OO-lah — the c is a soft \"tut\" click", m: "Sing (verb)", eg: "Siyathanda ukucula. — We love to sing." },
  { w: "Gijima", say: "gee-JEE-mah", m: "Run (verb)", eg: "Gijima ngokushesha! — Run fast!" },
  { w: "Hamba", say: "HAHM-bah", m: "Go, walk (verb)", eg: "Asihambe! — Let's go!" },
  { w: "Lala", say: "LAH-lah", m: "Sleep (verb)", eg: "Lala kahle. — Sleep well." },
  { w: "Vuka", say: "VOO-gah", m: "Wake up (verb)", eg: "Vuka! Sekusile! — Wake up! It's morning!" },
  { w: "Sebenza", say: "seh-BEN-zah", m: "Work (verb)", eg: "Ngisebenza kanzima. — I work hard." },
  { w: "Thenga", say: "TEN-gah", m: "Buy (verb)", eg: "Ngithenga isinkwa. — I am buying bread." },
  { w: "Buka", say: "BOO-gah", m: "Look, watch (verb)", eg: "Buka lokhu! — Look at this!" },
  { w: "Lalela", say: "lah-LEH-lah", m: "Listen (verb)", eg: "Lalela kahle. — Listen carefully." },
  { w: "Khuluma", say: "koo-LOO-mah", m: "Speak, talk (verb)", eg: "Ukhuluma isiZulu? — Do you speak Zulu?" },
  { w: "Siza", say: "SEE-zah", m: "Help (verb)", eg: "Ngicela ungisize. — Please help me." },
  { w: "Woza", say: "WOH-zah", m: "Come! (command)", eg: "Woza lapha! — Come here!" },
  { w: "Shesha", say: "SHEH-shah", m: "Hurry, be quick", eg: "Shesha, sizosala! — Hurry, we'll be left behind!" },
  { w: "Kahle", say: "GAH-shle", m: "Well, nicely — also \"slow down / easy!\"", eg: "Kwenze kahle. — Do it nicely." },
  { w: "Kakhulu", say: "gah-KOO-loo", m: "A lot, very much", eg: "Ngiyabonga kakhulu. — Thank you very much." },
  { w: "Kancane", say: "gahn-(click)AH-neh — the c is a soft \"tut\" click", m: "A little, slowly", eg: "Ngikhuluma isiZulu kancane. — I speak a little Zulu." },
  { w: "Igama", say: "ee-GAH-mah", m: "Name (also means \"word\" or \"song\")", eg: "Igama lami ngu-Brad. — My name is Brad." },
  { w: "Isibongo", say: "ee-see-BON-goh", m: "Surname / clan name — very important in Zulu culture", eg: "Ngubani isibongo sakho? — What is your surname?" },
  { w: "Umculo", say: "oom-(click)OO-loh — the c is a soft \"tut\" click", m: "Music", eg: "Ngithanda umculo. — I love music." },
  { w: "Impilo", say: "eem-PEE-loh", m: "Life, health", eg: "Impilo enhle! — Cheers! / To a good life!" },
  { w: "Ibhola", say: "ee-BOH-lah", m: "Ball — or football/soccer", eg: "Sibuka ibhola. — We are watching soccer." },
  { w: "Uxolo", say: "oo-(click)OH-loh — the x is a side-of-the-mouth click", m: "Sorry / excuse me (also means \"peace\")", eg: "Uxolo, ngiphuzile. — Sorry, I'm late." },
  { w: "Sanibonani", say: "sah-nee-boh-NAH-nee", m: "Hello (to more than one person)", eg: "Sanibonani nonke! — Hello everyone!" },
  { w: "Hhayibo!", say: "HAH-yee-boh", m: "\"No way!\" — surprise or disbelief", eg: "Hhayibo! Ngeke ngikholwe! — No way! I can't believe it!" },
];

// ---------------------------------------------------------------------------
// Did-you-know: tech & Claude facts in plain English (rotates daily)
// ---------------------------------------------------------------------------
const TECH_FACTS = [
  { t: "What is Claude?", f: "Claude is an AI assistant made by a company called Anthropic. You chat with it in normal language and it can answer questions, write documents, and even build whole apps — including this one, which was built entirely by Claude." },
  { t: "What is Supabase?", f: "Supabase is a free online database service. Think of it as a giant shared spreadsheet living on the internet that your apps can save things into and read back from — it's what apps use to remember data between visits and share it between people." },
  { t: "What is a pull request?", f: "A pull request (or \"PR\") is how programmers propose changes to code. Instead of changing the real thing directly, you submit your changes for review — like handing in a draft — and someone approves and merges them in. It's called that because you're asking the owner to \"pull\" your changes into their project." },
  { t: "What is GitHub?", f: "GitHub is a website where people store code projects. It keeps every version ever saved, so nothing is ever truly lost, and it lets many people work on the same project without stepping on each other. This very app lives on GitHub!" },
  { t: "What is Git?", f: "Git is the save-system underneath GitHub. Every time you \"commit\", Git takes a snapshot of your whole project. You can rewind to any snapshot ever taken — it's like unlimited undo for an entire project, going back years." },
  { t: "What is a commit?", f: "A commit is one saved snapshot of a project, with a short note explaining what changed — like \"Fixed the login button\". A project's history is just a long chain of commits, and you can travel back to any of them." },
  { t: "What is a repository?", f: "A repository (or \"repo\") is one project's folder on GitHub — all its files, plus its entire history of changes. Public repos can be seen by anyone; private ones only by people you invite." },
  { t: "What is a branch?", f: "A branch is a parallel copy of a project where you can experiment safely. The main version stays untouched while you work on your branch, and when you're happy, you merge your branch back in. Like practising on a photocopy before writing on the original." },
  { t: "What is 'merging'?", f: "Merging is combining two versions of a project into one. If two people changed different things, it happens automatically. If they changed the same line, that's a \"merge conflict\" and a human has to pick which version wins." },
  { t: "What is an API?", f: "An API is a way for two programs to talk to each other. When a weather app shows you the forecast, it's asking a weather company's API. Think of it as a restaurant menu: it lists exactly what you can ask for and how to ask." },
  { t: "What is an API key?", f: "An API key is like a password for programs. When your app asks another service for something (weather, AI answers, payments), the key proves it's really your app asking — and it's how the service knows whose account to bill. Never share yours!" },
  { t: "What is a PWA?", f: "A PWA (Progressive Web App) is a website that behaves like a real app: you can add it to your home screen, it gets its own icon, opens full-screen without the browser bar, and can even work offline. This app is a PWA — no app store needed." },
  { t: "What is a service worker?", f: "A service worker is a small invisible helper program that a website installs on your phone. It keeps working even when the page is closed — it's what lets web apps load offline and show notifications." },
  { t: "What is 'the cloud'?", f: "\"The cloud\" just means someone else's computers. When your photos are \"in the cloud\", they're on huge computer warehouses (data centres) owned by companies like Google, Amazon or Microsoft, which you reach over the internet." },
  { t: "What is a server?", f: "A server is a computer whose whole job is to answer requests from other computers. When you open a website, your phone asks a server \"please send me that page\", and the server sends it. It's called a server because it serves." },
  { t: "What is a database?", f: "A database is a program built for storing and finding information fast — names, orders, messages, scores. Like a filing cabinet with a superhumanly fast librarian: \"find every customer in Durban who ordered last month\" comes back in milliseconds." },
  { t: "What is SQL?", f: "SQL (often said \"sequel\") is the language used to ask databases questions. It reads almost like English: SELECT name FROM customers WHERE city = 'Durban'. It's been the standard way to talk to databases for nearly 50 years." },
  { t: "What is HTML?", f: "HTML is the language web pages are written in. It describes what's on the page — this is a heading, this is a paragraph, this is a button. Right-click any webpage, choose \"View source\", and you're looking at HTML." },
  { t: "What is CSS?", f: "If HTML says what is on a page, CSS says how it looks — colours, sizes, spacing, animations. The yellow theme of this app? That's CSS. Same page, different CSS, completely different look." },
  { t: "What is JavaScript?", f: "JavaScript is the language that makes web pages do things — react when you tap, fetch new data, update the screen. HTML is the skeleton, CSS is the outfit, JavaScript is the muscles." },
  { t: "Frontend vs backend?", f: "The frontend is everything you see and touch — buttons, screens, colours. The backend is the machinery behind the scenes — servers, databases, logic. A restaurant analogy: frontend is the dining room, backend is the kitchen." },
  { t: "What is an LLM?", f: "LLM stands for Large Language Model — the technology behind Claude and ChatGPT. It's a program trained on enormous amounts of text until it learned the patterns of language well enough to understand questions and write useful answers." },
  { t: "What are tokens?", f: "AI models like Claude read and write text in small chunks called tokens — roughly ¾ of a word each. AI pricing is usually per million tokens, which is why long conversations cost more than short ones." },
  { t: "What is a prompt?", f: "A prompt is whatever you type to an AI — your question or instruction. Writing better prompts gets dramatically better answers: give context, be specific, and say what format you want. \"Write a polite 3-sentence email declining the meeting\" beats \"write email\"." },
  { t: "What is a system prompt?", f: "A system prompt is a hidden instruction given to an AI before your conversation starts — like \"You are a helpful assistant for a bank; never give legal advice.\" It sets the AI's personality and rules without you ever seeing it." },
  { t: "What is AI 'hallucination'?", f: "When an AI confidently states something that's simply wrong — a fake fact, a made-up quote — that's called a hallucination. It happens because AIs predict plausible-sounding text rather than looking things up. Always double-check important facts!" },
  { t: "What is a context window?", f: "An AI's context window is its short-term memory — how much of the conversation it can \"see\" at once. Claude's can hold roughly a whole shelf of books. Anything that scrolls out of the window is forgotten unless it gets summarised." },
  { t: "What is an AI agent?", f: "A regular chatbot just answers. An AI agent takes actions: it can search the web, run programs, edit files, and work through multi-step tasks on its own — checking its own work as it goes. This app was built by an agent (Claude) that wrote, tested and published the code itself." },
  { t: "What is Claude Code?", f: "Claude Code is a version of Claude that works directly with code and computers. You describe what you want in plain English — \"build me an app that...\" — and it writes the files, fixes its own errors, and publishes the result. It's how this app was made." },
  { t: "What is MCP?", f: "MCP (Model Context Protocol) is like a universal plug standard for AI. It lets Claude connect to outside things — your calendar, GitHub, a database — through one common connector, instead of needing a custom cable for each." },
  { t: "What are Claude Artifacts?", f: "Artifacts are Claude's way of building something you can actually use — a working web page, a document, a diagram — in a panel next to the chat, instead of just describing it in words. You can watch it update live as you ask for changes." },
  { t: "What is JSON?", f: "JSON is the standard format programs use to pass data around, and it's actually readable: {\"name\": \"Brad\", \"city\": \"Durban\"}. When apps talk to servers, they're usually swapping JSON back and forth." },
  { t: "What is hosting?", f: "Hosting means putting your website's files on a server so the world can reach them. This app is hosted free on GitHub Pages — GitHub simply serves the files to anyone who visits the address. No monthly fees, no server to manage." },
  { t: "What is a domain name?", f: "A domain name is a website's human-friendly address, like mtn.co.za. Computers actually find each other by numbers (IP addresses); domains exist so people don't have to remember 102.132.96.5. You rent them yearly, usually for a few hundred rand." },
  { t: "What is DNS?", f: "DNS is the internet's phone book. When you type mtn.co.za, DNS looks up which numeric address that name points to, so your phone knows which server to call. Nearly every internet action starts with a DNS lookup." },
  { t: "What is HTTPS?", f: "The padlock in your browser means HTTPS: everything between you and the website is encrypted, so nobody in between — not the coffee-shop Wi-Fi, not your ISP — can read your passwords or card numbers in transit. Never type a password on a site without it." },
  { t: "What is a cookie?", f: "A cookie is a tiny note a website leaves in your browser so it recognises you next time — that's how sites keep you logged in. The annoying part: advertising cookies can follow you between sites, which is why every site now asks permission." },
  { t: "What is a cache?", f: "A cache is a nearby copy of something kept to avoid fetching it again — your browser saves images so pages load faster next visit. It's why \"clear your cache\" fixes weird website problems: you throw away possibly-stale copies and fetch fresh ones." },
  { t: "What is a bug?", f: "A bug is a mistake in a program. The name is real history: in 1947 engineers found an actual moth stuck inside a computer causing errors, taped it into the logbook, and wrote \"first actual case of bug being found\"." },
  { t: "What is debugging?", f: "Debugging is detective work on code: something's wrong, and you narrow down where. The classic technique is embarrassingly effective — explain the problem out loud, even to a rubber duck on your desk. Half the time you spot the answer mid-sentence." },
  { t: "What is open source?", f: "Open-source software publishes its recipe — anyone can read the code, check it, improve it, use it free. Huge parts of the internet run on it: Linux, Firefox, WordPress. Thousands of strangers collaborating on GitHub keep it alive." },
  { t: "What is localhost?", f: "\"localhost\" means \"this computer right here\". Developers run websites on localhost while building them — a private version only they can see — then publish to a real server when ready. If you ever see localhost in an address bar, you're looking at someone's work-in-progress." },
  { t: "What's in a web address?", f: "Take https://news.mtn.com/za/deals?ref=sms — https is the secure protocol, news.mtn.com is the server, /za/deals is the page on it, and ?ref=sms is extra info tagging where you came from. Every link breaks down this way." },
  { t: "What is RSS?", f: "RSS is an old but brilliant standard where websites publish their latest headlines in a machine-readable list. News apps (including this one!) read those lists to gather stories from many sites — no scrolling through each one." },
  { t: "What is a push notification?", f: "A push notification is a message a service sends to your phone — the phone keeps one quiet connection open to Google or Apple, and everything (WhatsApp, news, banking alerts) arrives through that shared pipe. That trick is what keeps it from destroying your battery." },
  { t: "What is a QR code?", f: "A QR code is just text — usually a web address — drawn as squares a camera can read. The three big corner squares tell the camera which way is up. Invented in 1994 for tracking car parts in Japanese factories; \"QR\" means Quick Response." },
  { t: "Wi-Fi vs mobile data?", f: "Both are wireless internet. Wi-Fi comes from a nearby router (usually connected to a fibre line) and is typically cheap or free. Mobile data comes from cell towers — MTN's business! — and works almost everywhere, but you pay per gigabyte." },
  { t: "What is a VPN?", f: "A VPN wraps your internet traffic in an encrypted tunnel to another computer, which then goes to websites on your behalf. Sites see the VPN's location, not yours, and your network can't see what you're doing — useful for privacy and for work systems." },
  { t: "What is 2FA?", f: "Two-factor authentication means a password alone isn't enough — you also need a code from your phone. Even if someone steals your password, they can't get in. Turn it on for email and banking first; email especially, since it can reset everything else." },
  { t: "What is phishing?", f: "Phishing is fake messages dressed up as real ones — \"Your package is held, click here\", \"Your account will be closed\". The link leads to a lookalike site that steals what you type. Golden rule: never log in from a link in a message; go to the site yourself." },
  { t: "What is encryption?", f: "Encryption scrambles information so only someone with the right key can unscramble it. \"End-to-end encrypted\" (like WhatsApp) means only your phone and the recipient's phone hold keys — not even the company in the middle can read the messages." },
  { t: "What is machine learning?", f: "Instead of programmers writing rules (\"spam contains the word 'winner'\"), machine learning shows a computer millions of examples and lets it work out the rules itself. That's how phones recognise faces and how Claude learned language." },
  { t: "What is a GPU?", f: "A GPU is a chip originally built to draw video-game graphics — thousands of tiny calculators working at once. It turned out that's exactly what AI needs, so AI companies now buy GPUs by the hundred thousand, and the top maker (Nvidia) became one of the world's most valuable companies." },
  { t: "What is prompt engineering?", f: "Prompt engineering is the craft of phrasing AI requests to get great results. Three big levers: give context (\"I run a small phone shop in KZN\"), be specific about the output (\"a 5-line WhatsApp message\"), and give an example of what good looks like." },
  { t: "What is 'vibe coding'?", f: "Vibe coding is building software by describing what you want to an AI in plain English and letting it write all the code — no programming knowledge needed. You react to what it builds (\"make the button bigger\", \"add a leaderboard\") like directing a builder. It's how this app exists." },
  { t: "What is a README?", f: "A README is the welcome note in a code project — what it is, how to run it, how to help. On GitHub it displays automatically on the project's front page. The name is an instruction: read me (first)." },
  { t: "What is Markdown?", f: "Markdown is a way to format text with simple symbols: *asterisks* for bold-ish emphasis, # for headings, - for bullet lists. It's what you write in WhatsApp when you use *stars* for bold — and what most READMEs, and Claude's answers, are written in." },
  { t: "What do version numbers mean?", f: "Software versions like 2.4.1 follow a pattern: the first number is big changes, the second is new features, the third is small fixes. So 2.4.1 → 2.4.2 is a tiny patch, but 2.x → 3.0 might change everything. It's called semantic versioning." },
  { t: "What is a 404?", f: "Every web request gets a status code back: 200 means OK, 404 means \"page not found\", 500 means the server itself broke. 404 is the famous one — you asked for a page that doesn't exist, often because of a typo or a dead link." },
  { t: "What is an IP address?", f: "An IP address is a device's number on a network, like 196.11.240.5 — the internet's version of a street address. Domain names exist purely so humans don't have to memorise these numbers." },
  { t: "What is RAG?", f: "RAG (Retrieval-Augmented Generation) is how AI assistants answer questions about your documents: first fetch the relevant pages from a library, then have the AI answer using what it just read. It keeps answers grounded in real sources instead of memory." },
  { t: "What is no-code?", f: "No-code tools let you build apps by dragging blocks around instead of writing code — think website builders like Wix, or automation tools like Zapier. AI tools like Claude have pushed this further: now plain English is the interface." },
];

// ---------------------------------------------------------------------------
// Daily rotation — same pick for everyone on the same calendar day
// ---------------------------------------------------------------------------
function dayNumber(date) {
  const d = date || new Date();
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}
function zuluWordOfTheDay(date) {
  return ZULU_WORDS[dayNumber(date) % ZULU_WORDS.length];
}
function techFactOfTheDay(date) {
  return TECH_FACTS[dayNumber(date) % TECH_FACTS.length];
}

// ---------------------------------------------------------------------------
// MTN news via Google News RSS. Browsers block cross-site RSS fetches (CORS),
// so we go through free proxy services, trying each until one works.
// Parsed with regex (not DOMParser) so it also works inside the service worker.
// ---------------------------------------------------------------------------
const NEWS_RSS_URL =
  "https://news.google.com/rss/search?q=" +
  encodeURIComponent('"MTN" telecom OR "MTN Group" OR "MTN South Africa"') +
  "&hl=en-ZA&gl=ZA&ceid=ZA:en";

const NEWS_PROXIES = [
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
];

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .trim();
}

function parseRssItems(xml, max) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const title = (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const link = (b.match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    const source = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1];
    if (!title) continue;
    items.push({
      title: decodeEntities(title),
      link: link ? decodeEntities(link) : "#",
      pub: pub ? new Date(decodeEntities(pub)) : null,
      source: source ? decodeEntities(source) : "",
    });
    if (items.length >= max) break;
  }
  return items;
}

async function fetchMtnNews(max) {
  max = max || 6;
  let lastErr = null;
  for (const wrap of NEWS_PROXIES) {
    try {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
      const res = await fetch(wrap(NEWS_RSS_URL), controller ? { signal: controller.signal } : {});
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const xml = await res.text();
      const items = parseRssItems(xml, max);
      if (items.length) return items;
      throw new Error("no items parsed");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("all news sources failed");
}

// ---------------------------------------------------------------------------
// Optional AI mode — a real Claude agent that searches today's web for MTN
// news and writes a summary. Needs the user's own Anthropic API key
// (stored only on this device). Uses Claude Opus with the web-search tool.
// ---------------------------------------------------------------------------
async function fetchAiBrief(apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
      messages: [{
        role: "user",
        content:
          "Search the web for today's news about MTN (the African mobile telecommunications company, " +
          "MTN Group / MTN South Africa). Then write a friendly morning-brief summary: 3 to 5 short " +
          "bullet points of the most interesting recent MTN news, each one or two sentences, plain " +
          "English, no jargon. If there is genuinely nothing new today, say so and summarise the most " +
          "recent notable stories instead. Reply with the bullet points only — no preamble.",
      }],
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body.error && body.error.message) || ("HTTP " + res.status);
    throw new Error(msg);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("Claude declined this request — showing headlines instead.");
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Empty AI response");
  return text;
}
