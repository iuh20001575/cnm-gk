require('dotenv').config();
const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');

const app = express();
const PORT = 8080;
const upload = multer({
    limits: { fileSize: 2000000 },
    fileFilter: (_req, file, cb) => {
        const fileTypes = /(png|jpg|jpeg|gif)$/;

        if (
            fileTypes.test(file.originalname.toLowerCase()) &&
            fileTypes.test(file.mimetype)
        )
            return cb(null, true);

        return cb('Error: Only accept file image');
    },
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('./templates'));
app.set('view engine', 'ejs');
app.set('views', './templates');

AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const tableName = process.env.DYNAMODB_NAME;
const s3Name = process.env.S3_NAME;

const uploadImage = (file, id = '') => {
    const fileName = `${id}_${Date.now()}.${file.originalname
        .split('.')
        .at(-1)}`;

    return new Promise((res, rej) => {
        s3.upload(
            {
                Bucket: s3Name,
                ContentType: file.mimetype,
                Body: file.buffer,
                Key: fileName,
            },
            (error, data) => {
                if (error) rej(error);

                res(data.Location);
            },
        );
    });
};

app.get('/', async (_req, res) => {
    try {
        const data = await dynamoDB
            .scan({
                TableName: tableName,
            })
            .promise();

        dynamoDB.res.render('index', { students: data.Items });
    } catch (error) {
        console.error(error);

        res.status(500).send('Error: Get data from DynamoDB');
    }
});

app.post('/add', upload.single('avatar'), async (req, res) => {
    try {
        const { id, name, dob, gender } = req.body;
        const fileName = `${id}_${Date.now()}.${req.file.originalname
            .split('.')
            .at(-1)}`;

        const imageUrl = await uploadImage(req.file, id);

        dynamoDB.put(
            {
                TableName: tableName,
                Item: {
                    id,
                    name,
                    dob,
                    gender: gender === 'male',
                    avatar: imageUrl,
                },
            },
            (error) => {
                if (error) {
                    console.error(error);

                    return res.status(500).send('Error: Add file to S3');
                }

                res.redirect('/');
            },
        );
    } catch (error) {
        console.error(error);

        res.status(500).send('Error: Add data to DynamoDB');
    }
});

app.get('/student-male', async (_req, res) => {
    try {
        const data = await dynamoDB
            .scan({
                TableName: tableName,
                FilterExpression: 'gender = :gender',
                ExpressionAttributeValues: {
                    ':gender': true,
                },
            })
            .promise();

        res.render('maleStudent', { students: data.Items });
    } catch (error) {
        console.error(error);

        res.status(500).send('Error: Get data from DynamoDB');
    }
});

app.get('/student-detail', async (req, res) => {
    const id = req.query.id;

    try {
        const data = await dynamoDB
            .scan({
                TableName: tableName,
                FilterExpression: 'id = :id',
                ExpressionAttributeValues: {
                    ':id': id,
                },
            })
            .promise();

        if (data.Items.length)
            return res.render('studentDetail', { student: data.Items[0] });

        res.render('404');
    } catch (error) {
        console.error(error);

        res.status(500).send('Error: Get data from DynamoDB');
    }
});

app.post('/delete', upload.none(), async (req, res) => {
    const ids = Object.keys(req.body);
    console.log('🚀 ~ app.post ~ ids:', ids);

    try {
        await Promise.all(
            ids.map((id) =>
                dynamoDB
                    .delete({
                        TableName: tableName,
                        Key: {
                            id,
                        },
                    })
                    .promise(),
            ),
        );

        res.redirect('/');
    } catch (error) {
        console.error(error);

        res.status(500).send('Error: Delete item from DynamoDB');
    }
});

app.get('/students/:id', async (req, res) => {
    const id = req.params.id;

    try {
        const data = await dynamoDB
            .scan({
                TableName: tableName,
                FilterExpression: 'id = :id',
                ExpressionAttributeValues: {
                    ':id': id,
                },
            })
            .promise();

        if (data.Items.length)
            return res.render('edit', { student: data.Items[0] });
        return res.render('404');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error: Get item from DynamoDB');
    }
});

app.post('/edit', upload.single('avatar'), async (req, res) => {
    const { id, name, dob, gender } = req.body;
    console.log('🚀 ~ app.post ~ name:', name);
    const values = {};

    try {
        if (req.file) values[':avatar'] = await uploadImage(req.file, id);
        console.log('🚀 ~ app.post ~ values:', values);

        dynamoDB.update(
            {
                TableName: tableName,
                Key: { id },
                UpdateExpression: `set #name = :name, dob = :dob, gender = :gender ${
                    values[':avatar'] ? ', avatar = :avatar' : ''
                }`,
                ExpressionAttributeValues: {
                    ':name': name,
                    ':dob': dob,
                    ':gender': gender === 'male',
                    ...values,
                },
                ExpressionAttributeNames: {
                    '#name': 'name',
                },
                ReturnValues: 'ALL_NEW',
            },
            (error, data) => {
                if (error) {
                    console.error(error);

                    return res
                        .status(500)
                        .send('Error: Update item to DynamoDB');
                }

                console.log(data);

                return res.redirect('/');
            },
        );
    } catch (error) {
        console.error(error);

        res.sendStatus(500);
    }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}...`));
