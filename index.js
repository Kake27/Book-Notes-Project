import express from "express"
import pg from "pg"
import bodyParser from "body-parser"
import axios from "axios";
import env from "dotenv"

const app = express();
const port = 3000;

env.config();

app.use(express.static("public"));
app.use(bodyParser.urlencoded({extended: true}));


function parseQuery(response) {
    const data = response.data.docs;

    const titleArray = data.map((book) => book.title)
    const authorArray = data.map((book) => book.author_name ? book.author_name[0] : "Unknown")
    const coverIdArray = data.map((book) => book.cover_i)
    
    const combined = titleArray.map((title, index) => {
        return {
            title: title,
            author: authorArray[index],
            coverUrl: `https://covers.openlibrary.org/b/id/${coverIdArray[index]}-M.jpg?default=https://openlibrary.org/static/images/icons/avatar_book-sm.png`
        }
    })

    return combined;
}


const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "bookrecords",
    password: process.env.DATABASE_PASSWORD,
    port: 5432
})

db.connect();

let sort = "review_id"

app.get("/", async (req, res) => {
    try {
        const response = await db.query(`
            SELECT * FROM book
            JOIN book_review ON book.book_id=book_review.book_id
            ORDER BY ${sort} ASC`
        )
        const data = response.rows;

        res.render("index.ejs", {data: data})

    } catch(error) {
        console.log(error)
    }
})

app.get("/search", async(req, res) => {
    const query = req.query.search
    const response = await axios.get(`https://openlibrary.org/search.json?q=${query.replace(" ", "+")}&limit=10`)

    const combined = parseQuery(response);

    res.render("view.ejs", {data: combined})
})


app.get("/view", async(req, res) => {
    const data = req.query

    res.render("create.ejs", {book_data: data})
})


app.post("/sort", async (req, res) => {
    sort = req.body.sort;
    res.redirect("/")

})


app.get("/review/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const book_info = await db.query(`
            SELECT * FROM book
            WHERE book.book_id = $1`, [id])
        
        const review_info = await db.query(`
            SELECT * FROM book_review
            WHERE book_review.book_id = $1`, [id])


        res.render("display.ejs", {book_info: book_info.rows[0], review_info: review_info.rows[0]})
    } catch(error) {
        console.log(error)
    }
})


app.get("/delete/:id", async(req, res) => {

    const id = req.params.id
    try {
        await db.query("BEGIN")
        await db.query(`
            DELETE FROM book_review
            WHERE book_review.book_id=$1`, [id])
        await db.query(`
            DELETE FROM book
            WHERE book.book_id=$1`, [id])
        await db.query("COMMIT")

    } catch(error) {
        await db.query("ROLLBACK")
        console.log(error)
    }

    res.redirect("/")

})

app.get("/create", (req,res) => {
    res.render("create.ejs")
})

app.get("/edit/:id", async(req, res) => {
    const id = req.params.id;

    try {
        const book_info = await db.query(`
            SELECT * FROM book
            WHERE book.book_id = $1`, [id])
        
        const review_info = await db.query(`
            SELECT * FROM book_review
            WHERE book_review.book_id = $1`, [id])


        res.render("create.ejs", {book_info: book_info.rows[0], review_info: review_info.rows[0]})
    } catch(error) {
        console.log(error)
    }
})

app.post("/update", async (req, res) => {
    const id = req.body.id;
    const newTitle = req.body.title;
    const newAuthor = req.body.author;
    const newReview = req.body.review
    const newUrl = req.body.coverUrl
    const newRating = req.body.rating;

    try {
            await db.query(`
            UPDATE book_review
            SET review=$1, rating=$2
            WHERE book_id=$3`, [newReview, newRating, id])

            await db.query(`
            UPDATE book 
            SET title=$1, author=$2, cover_url=$3
            WHERE book_id=$4`, [newTitle, newAuthor, newUrl, id])

        const response = await db.query(`
            SELECT * FROM book
            JOIN book_review ON book.book_id=book_review.book_id
            ORDER BY review_id ASC`)

        const data = response.rows;
        res.render("index.ejs", {data: data})

    } catch(error) {
        console.log(error)
    }
})

app.post("/save", async (req, res) => {
    const title = req.body.title;
    const author = req.body.author;
    const review = req.body.review;
    const url = req.body.coverUrl;
    const rating = req.body.rating;

    try {
        await db.query('BEGIN');

        let newBook;
        
        if (url) {
            newBook = await db.query(
                `INSERT INTO book (title, author, cover_url)
                VALUES ($1, $2, $3)
                RETURNING book_id`, [title, author, url]
            );

        } else {
            const response = await axios.get(`https://openlibrary.org/search.json?q=${title.replace(" ", "+")}&limit=5`)
            const cover_id = response.data.docs[0].cover_edition_key

            const cover_url = `https://covers.openlibrary.org/b/olid/${cover_id}-M.jpg`
            
            newBook = await db.query(
                `INSERT INTO book (title, author, cover_url)
                VALUES ($1, $2, $3)
                RETURNING book_id`, [title, author, cover_url]
            );
        }

        const newReview = await db.query(
            `INSERT INTO book_review (book_id, review, rating)
            VALUES ($1, $2, $3)
            RETURNING *`, [newBook.rows[0].book_id, review, rating]
        );

        await db.query('COMMIT');
        res.redirect("/");

    } catch (error) {
        await db.query('ROLLBACK');
        console.log(error);
    }
})


app.listen(port, () => {
    console.log(`Server is up ${port}`);
})