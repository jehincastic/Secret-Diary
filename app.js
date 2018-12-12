var express                 = require('express'),
    app                     = express(),
    bodyParser              = require("body-parser"),
    mongoose                = require("mongoose"),
    expressSanitizer        = require("express-sanitizer"),
    passportLocalMongoose   = require("passport-local-mongoose"),
    passport                = require('passport'),
    flash                   = require('connect-flash'),
    LocalStrategy           = require('passport-local'),
    nodemailer              = require('nodemailer'),
    methodOverride          = require("method-override"),
    config                  = require('./secrets');

function makeHash() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    
    for (var i = 0; i < 25; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    
    return text;
}

var userSchema = new mongoose.Schema({
    username : String,
    email : { type: String, unique: true, lowercase: true },
    password : String,
    activate : Boolean,
    uniqueCode : { 
        type: String,
        default: makeHash()
    }
});
userSchema.plugin(passportLocalMongoose);
var User = mongoose.model('User', userSchema);


var diarySchema = new mongoose.Schema({
    content : [
        {type : String}
    ],
    dates : [
        {type : String}
    ],
    user : {
        id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        username: String
    }
});
var Diary = mongoose.model("Diary", diarySchema);

app.use(flash());
mongoose.connect("mongodb://localhost/diary_app", { useNewUrlParser: true });
mongoose.set("useFindAndModify", false);
app.use(bodyParser.urlencoded({extended: true}));
app.use(expressSanitizer());
app.set("view engine", "ejs");
app.use(express.static(__dirname + "/public"));
app.use(methodOverride("_method"));
app.use(require('express-session')({
    secret: "Once again you are logged in.",
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'chickendinnerindia@gmail.com',
      pass: config.emailPassword
    }
});

app.use((req, res, next) => {
    res.locals.currentUser  = req.user;
    res.locals.error      = req.flash('error');
    res.locals.success      = req.flash('success');
    next();
});

app.get("/", (req, res) => {
    res.render("index");
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.post("/login", passport.authenticate('local', {
    successRedirect:'/diary',
    failureRedirect:'/login'
}), (req, res) => {});

app.get("/register", (req, res) => {
    res.render("register");
});

app.post("/register", (req, res) => {
    var newUser = {
        username : req.body.username,
        email : req.body.email
    };
    User.register(newUser, req.body.password, (err, user) => {
        if(err){
            req.flash("error", "Username/Email already exists");
            return res.redirect("/register");
        }
        passport.authenticate("local")(req, res, function(){
            req.flash("success", "Registered successfully.");
            var mailOptions = {
                from: 'jehincastic@gmail.com',
                to: req.user.email,
                subject: 'Verification mail from Diary',
                html: "Please enter the code in the verification text box at the verification page : <strong>"+ req.user.uniqueCode +"</strong>"
            };  
            transporter.sendMail(mailOptions, function(error, info){
            if (error) {
                console.log(error);
            } else {
                console.log('Email sent: ' + info.response);
            }
            });
            res.redirect("/diary");
        });
    })
});

app.get("/diary", isLoggedIn, (req, res) => {
    Diary.find({}, function(err, found) {
        if(err) {
            console.log(err);
        }
        else {
            res.render("diary", {diary : found});
        }
    });
});

app.post("/diary", isLoggedIn, (req, res) => {
    var content =  req.sanitize(req.body.content);
    var postUser = {
        id : req.user._id,
        username : req.user.username,
        activate : false
    };
    if (!content || content.trim() == ''){
        req.flash("error", "Content cannot be empty.");
        res.redirect('/diary');
    }
    else {
        var date = new Date(Date.now()).toDateString();
        Diary.create({content : content, dates : date, user: postUser}, (err, newDiary) => {
            if(err || !newDiary) {
                res.redirect("/diary");
            }
            else {
                req.flash("success", "Diary Content Created Successfully");
                res.redirect("/diary");
            }
        });
    }
});

app.get('/logout', (req, res) => {
    req.logout();
    req.flash('success', 'Logged Out Successfully!');
    res.redirect("/");
});

app.delete("/diary/:id", isLoggedIn, (req, res) => {
    Diary.findByIdAndRemove(req.params.id, (err) => {
        if(err) {
            req.flash("error", "Diary Content Could Not Be Deleted.");
            res.redirect("/diary");
        }
        else {
            req.flash("success", "Diary Content Deleted Successfully.");
            res.redirect("/diary");
        }
    });
});

app.get("/verify", isLoggedInVerify, (req, res) => {
    res.render("verify");
});

app.post("/verify", isLoggedInVerify, (req, res) => {
    if (req.body.verifyId === req.user.uniqueCode) {
        id = req.user._id;
        User.findById(id, (err, user) => {
            user.activate = true;
            user.save((err, updatedUser) => {
                req.flash("success", "Your Email has been verified.");
                return res.redirect("/diary")
            });
        });
    }
    else {
        req.flash("error", "Verification Code is Wrong.");
        return res.redirect("/verify");
    }
});

app.get("/diary/:id/edit", checkDiaryOwenship, (req, res) => {
    Diary.findById(req.params.id, (err, foundDiary) => {
        if (err) {
            req.flash("error", "Diary Content not found.");
        }
        else {
            res.render("edit", {diary : foundDiary});
        }
    });
});

app.put("/diary/:id", checkDiaryOwenship, (req, res) => {
    Diary.findById(req.params.id, (err, diary) => {
        if (!req.body.content || req.body.content.trim() == ''){
            req.flash("error", "Content cannot be empty.");
            res.redirect('/diary');
        }
        else {
            diary.content = req.body.content;
            diary.save((err, updatedDiary) => {
                req.flash("success", "Updated Successfully.");
                return res.redirect("/diary")
            });
        }
    });
});

function isLoggedIn(req, res, next) {
    if(req.isAuthenticated()) {
        if (!req.user.activate) {
            return res.redirect("/verify");
        }
        else {
            return next();
        }
    }
    res.redirect("/login");
}

function isLoggedInVerify(req, res, next) {
    if(req.isAuthenticated()) {
        if (req.user.activate) {
            return res.redirect("/diary");
        }
        else {
            return next();
        }
    }
    res.redirect("/login");
}

function checkDiaryOwenship (req, res, next) {
    if(req.isAuthenticated()) {
        Diary.findById(req.params.id, (err, foundDiary) => {
            if(err || !foundDiary) {
                req.flash("error", "Diary content not found.");
                res.redirect('/diary');
            }
            else {
                if(foundDiary.user.id.equals(req.user._id)){
                    next();
                }
                else {
                    req.flash("error", "You don't have right permission to do that.");
                    res.redirect('/diary');
                }
            }
        });
    } else {
        req.flash("error", "You need to be to Logged in to do that.");
        res.redirect('/login');
    }
}

app.listen(4000,'localhost', () => {
    console.log("Server is started");
});